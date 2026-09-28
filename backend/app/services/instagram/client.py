from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx
import structlog

from app.config.settings import Settings
from app.models.base import utcnow

logger = structlog.get_logger(__name__)

_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize"
_TOKEN_URL = "https://api.instagram.com/oauth/access_token"  # noqa: S105 - public endpoint URL
_GRAPH_HOST = "https://graph.instagram.com"
# Meta error codes: 190 = invalid/expired token; 4/17/32/613 = rate limits; 1/2 = transient.
_TOKEN_CODES = frozenset({190})
_RATE_LIMIT_CODES = frozenset({4, 17, 32, 613})
_TRANSIENT_CODES = frozenset({1, 2})


class InstagramApiError(Exception):
    """Failure from Meta. `status_code` is 0 for transport-level failures."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        code: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.retry_after = retry_after

    @property
    def is_token_error(self) -> bool:
        return self.code in _TOKEN_CODES or self.status_code == 401

    @property
    def is_rate_limited(self) -> bool:
        return self.status_code == 429 or self.code in _RATE_LIMIT_CODES

    @property
    def is_retryable(self) -> bool:
        return (
            self.status_code == 0
            or self.status_code >= 500
            or self.is_rate_limited
            or self.code in _TRANSIENT_CODES
        )


@dataclass(frozen=True, slots=True)
class ShortLivedToken:
    access_token: str
    user_id: str
    permissions: list[str]


@dataclass(frozen=True, slots=True)
class LongLivedToken:
    access_token: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class InstagramProfile:
    user_id: str
    username: str
    account_type: str


class InstagramApi(Protocol):
    """Everything the app needs from Instagram. Business logic depends on this, not on HTTP."""

    def authorization_url(self, state: str) -> str: ...
    async def exchange_code(self, code: str) -> ShortLivedToken: ...
    async def exchange_long_lived(self, short_token: str) -> LongLivedToken: ...
    async def refresh_token(self, token: str) -> LongLivedToken: ...
    async def get_profile(self, token: str) -> InstagramProfile: ...
    async def subscribe_webhooks(self, token: str) -> None: ...
    async def send_dm(self, token: str, account_id: str, recipient_id: str, text: str) -> str: ...
    async def send_private_reply(
        self, token: str, account_id: str, comment_id: str, text: str
    ) -> str: ...
    async def reply_to_comment(self, token: str, comment_id: str, text: str) -> str: ...


def _permissions(raw: Any) -> list[str]:
    if isinstance(raw, str):
        return [item.strip() for item in raw.split(",") if item.strip()]
    return [str(item) for item in raw or []]


class GraphInstagramApi:
    """Instagram API with Instagram Login (graph.instagram.com). Tokens travel in headers or POST
    bodies wherever Meta allows; only the two token-exchange GETs require query parameters."""

    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings
        self._base = f"{_GRAPH_HOST}/{settings.meta_graph_api_version}"

    def authorization_url(self, state: str) -> str:
        query = urlencode(
            {
                "client_id": self._settings.meta_app_id,
                "redirect_uri": self._settings.meta_redirect_uri,
                "response_type": "code",
                "scope": ",".join(self._settings.meta_oauth_scopes),
                "state": state,
            }
        )
        return f"{_AUTHORIZE_URL}?{query}"

    async def exchange_code(self, code: str) -> ShortLivedToken:
        payload = await self._request(
            "POST",
            _TOKEN_URL,
            data={
                "client_id": self._settings.meta_app_id,
                "client_secret": self._settings.meta_app_secret.get_secret_value(),
                "grant_type": "authorization_code",
                "redirect_uri": self._settings.meta_redirect_uri,
                "code": code,
            },
        )
        record = payload["data"][0] if "data" in payload else payload
        return ShortLivedToken(
            access_token=record["access_token"],
            user_id=str(record["user_id"]),
            permissions=_permissions(record.get("permissions")),
        )

    async def exchange_long_lived(self, short_token: str) -> LongLivedToken:
        payload = await self._request(
            "GET",
            f"{_GRAPH_HOST}/access_token",
            params={
                "grant_type": "ig_exchange_token",
                "client_secret": self._settings.meta_app_secret.get_secret_value(),
                "access_token": short_token,
            },
        )
        return self._long_lived(payload)

    async def refresh_token(self, token: str) -> LongLivedToken:
        payload = await self._request(
            "GET",
            f"{_GRAPH_HOST}/refresh_access_token",
            params={"grant_type": "ig_refresh_token", "access_token": token},
        )
        return self._long_lived(payload)

    async def get_profile(self, token: str) -> InstagramProfile:
        payload = await self._request(
            "GET",
            f"{self._base}/me",
            token=token,
            params={"fields": "user_id,username,account_type"},
        )
        if "user_id" not in payload or "username" not in payload:
            raise InstagramApiError("Incomplete profile response.", status_code=502)
        return InstagramProfile(
            user_id=str(payload["user_id"]),
            username=payload["username"],
            account_type=str(payload.get("account_type", "")),
        )

    async def subscribe_webhooks(self, token: str) -> None:
        await self._request(
            "POST",
            f"{self._base}/me/subscribed_apps",
            token=token,
            params={"subscribed_fields": ",".join(self._settings.meta_webhook_fields)},
        )

    async def send_dm(self, token: str, account_id: str, recipient_id: str, text: str) -> str:
        return await self._send_message(token, account_id, {"id": recipient_id}, text)

    async def send_private_reply(
        self, token: str, account_id: str, comment_id: str, text: str
    ) -> str:
        return await self._send_message(token, account_id, {"comment_id": comment_id}, text)

    async def reply_to_comment(self, token: str, comment_id: str, text: str) -> str:
        payload = await self._request(
            "POST", f"{self._base}/{comment_id}/replies", token=token, data={"message": text}
        )
        return str(payload["id"])

    async def _send_message(
        self, token: str, account_id: str, recipient: dict[str, str], text: str
    ) -> str:
        payload = await self._request(
            "POST",
            f"{self._base}/{account_id}/messages",
            token=token,
            json={"recipient": recipient, "message": {"text": text}},
        )
        return str(payload["message_id"])

    @staticmethod
    def _long_lived(payload: dict[str, Any]) -> LongLivedToken:
        return LongLivedToken(
            access_token=payload["access_token"],
            expires_at=utcnow() + timedelta(seconds=int(payload["expires_in"])),
        )

    async def _request(
        self,
        method: str,
        url: str,
        *,
        token: str | None = None,
        params: dict[str, str] | None = None,
        data: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {token}"} if token else None
        try:
            response = await self._client.request(
                method,
                url,
                params=params,
                data=data,
                json=json,
                headers=headers,
                timeout=self._settings.meta_http_timeout_seconds,
            )
        except httpx.TransportError as exc:
            raise InstagramApiError("Could not reach Instagram.", status_code=0) from exc
        try:
            body: dict[str, Any] = response.json()
        except ValueError:
            body = {}
        if response.is_success:
            return body
        error = body.get("error", {}) if isinstance(body.get("error"), dict) else {}
        retry_header = response.headers.get("Retry-After")
        logger.warning(
            "instagram_api_error",
            status=response.status_code,
            code=error.get("code"),
            path=response.request.url.path,
        )
        raise InstagramApiError(
            error.get("message") or body.get("error_message") or "Instagram request failed.",
            status_code=response.status_code,
            code=error.get("code") or body.get("code"),
            retry_after=float(retry_header) if retry_header and retry_header.isdigit() else None,
        )
