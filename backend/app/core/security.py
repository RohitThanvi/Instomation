import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from jwt import PyJWK

from app.core.errors import AppError

JwksFetcher = Callable[[], Awaitable[dict[str, Any]]]

_ALLOWED_ALGORITHMS = ["RS256"]


def unauthenticated(message: str = "Authentication is required.") -> AppError:
    return AppError("UNAUTHENTICATED", message, 401)


@dataclass(frozen=True, slots=True)
class Identity:
    """Verified Clerk identity. Carries no tenant information by design."""

    clerk_user_id: str
    session_id: str | None


def http_jwks_fetcher(url: str, client: httpx.AsyncClient) -> JwksFetcher:
    async def fetch() -> dict[str, Any]:
        response = await client.get(url, timeout=5.0)
        response.raise_for_status()
        return response.json()  # type: ignore[no-any-return]

    return fetch


class ClerkTokenVerifier:
    """Verifies Clerk session JWTs against the instance JWKS.

    Keys are cached with a TTL. An unknown `kid` triggers a refetch, rate-limited so that
    forged tokens cannot be used to hammer the JWKS endpoint.
    """

    def __init__(
        self,
        fetch_jwks: JwksFetcher,
        issuer: str,
        authorized_parties: list[str],
        cache_seconds: int,
        min_refetch_seconds: int,
    ) -> None:
        self._fetch_jwks = fetch_jwks
        self._issuer = issuer
        self._authorized_parties = frozenset(authorized_parties)
        self._cache_seconds = cache_seconds
        self._min_refetch_seconds = min_refetch_seconds
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at = 0.0
        self._lock = asyncio.Lock()

    async def verify(self, token: str) -> Identity:
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except jwt.PyJWTError as exc:
            raise unauthenticated("Invalid authentication token.") from exc
        if not kid:
            raise unauthenticated("Invalid authentication token.")

        key = await self._key_for(kid)
        try:
            claims = jwt.decode(
                token,
                key.key,
                algorithms=_ALLOWED_ALGORITHMS,
                issuer=self._issuer,
                options={"require": ["exp", "iat", "sub", "iss"], "verify_aud": False},
            )
        except jwt.ExpiredSignatureError as exc:
            raise unauthenticated("Your session has expired.") from exc
        except jwt.PyJWTError as exc:
            raise unauthenticated("Invalid authentication token.") from exc

        azp = claims.get("azp")
        if self._authorized_parties and azp not in self._authorized_parties:
            raise unauthenticated("Invalid authentication token.")
        return Identity(clerk_user_id=claims["sub"], session_id=claims.get("sid"))

    async def _key_for(self, kid: str) -> PyJWK:
        now = time.monotonic()
        cache_expired = now - self._fetched_at > self._cache_seconds
        if kid in self._keys and not cache_expired:
            return self._keys[kid]

        async with self._lock:
            now = time.monotonic()
            cache_expired = now - self._fetched_at > self._cache_seconds
            can_refetch = now - self._fetched_at >= self._min_refetch_seconds
            if cache_expired or (kid not in self._keys and can_refetch):
                await self._refresh()
        key = self._keys.get(kid)
        if key is None:
            raise unauthenticated("Invalid authentication token.")
        return key

    async def _refresh(self) -> None:
        try:
            document = await self._fetch_jwks()
        except (httpx.HTTPError, ValueError) as exc:
            raise AppError(
                "AUTH_PROVIDER_UNAVAILABLE", "Authentication is temporarily unavailable.", 503
            ) from exc
        self._keys = {
            jwk["kid"]: PyJWK.from_dict(jwk) for jwk in document.get("keys", []) if "kid" in jwk
        }
        self._fetched_at = time.monotonic()
