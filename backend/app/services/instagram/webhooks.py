import hashlib
import hmac
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from app.config.settings import Settings


class WebhookVerificationError(Exception):
    """Raised when the GET verification handshake does not match our configured token."""


def verify_challenge(settings: Settings, mode: str | None, token: str | None) -> None:
    """Meta's one-time GET handshake when the webhook subscription is (re)configured."""
    expected = settings.meta_webhook_verify_token.get_secret_value()
    if mode != "subscribe" or not expected or not hmac.compare_digest(token or "", expected):
        raise WebhookVerificationError


def verify_signature(settings: Settings, raw_body: bytes, header_value: str | None) -> bool:
    """Constant-time check of `X-Hub-Signature-256: sha256=<hex>` against the app secret.

    Signed over the exact bytes Meta sent (do not re-serialize JSON before checking).
    """
    if not header_value or not header_value.startswith("sha256="):
        return False
    expected = hmac.new(
        settings.meta_app_secret.get_secret_value().encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(header_value.removeprefix("sha256="), expected)


class MessagingEntry(BaseModel):
    """Subset of Meta's messaging payload we currently act on; unknown fields are ignored."""

    model_config = {"extra": "ignore"}
    sender: dict[str, Any] = Field(default_factory=dict)
    recipient: dict[str, Any] = Field(default_factory=dict)
    timestamp: int | None = None
    message: dict[str, Any] | None = None


class ChangeValue(BaseModel):
    model_config = {"extra": "ignore"}
    id: str | None = None
    text: str | None = None
    media: dict[str, Any] | None = None
    from_: dict[str, Any] | None = Field(default=None, alias="from")


class Change(BaseModel):
    model_config = {"extra": "ignore"}
    field: str
    value: ChangeValue


class WebhookEntry(BaseModel):
    model_config = {"extra": "ignore"}
    id: str
    time: int | None = None
    messaging: list[MessagingEntry] = Field(default_factory=list)
    changes: list[Change] = Field(default_factory=list)


class WebhookPayload(BaseModel):
    """Top-level Instagram webhook body. Everything here is untrusted input."""

    model_config = {"extra": "ignore"}
    object: str
    entry: list[WebhookEntry] = Field(default_factory=list)


class ParsedItem(BaseModel):
    """One dedupable unit of work extracted from a webhook entry."""

    external_account_id: str
    external_event_id: str
    event_type: str
    data: dict[str, Any]


def parse_payload(raw_body: bytes) -> WebhookPayload:
    try:
        return WebhookPayload.model_validate_json(raw_body)
    except ValidationError as exc:
        raise ValueError("Malformed webhook payload.") from exc


def extract_items(payload: WebhookPayload) -> list[ParsedItem]:
    """Flatten entries into individually dedupable items. Unknown/unrecognized items are skipped
    (never raise), so one bad item in a batch cannot block the ones we do understand."""
    items: list[ParsedItem] = []
    for entry in payload.entry:
        for message in entry.messaging:
            mid = (message.message or {}).get("mid")
            if not mid:
                continue
            items.append(
                ParsedItem(
                    external_account_id=entry.id,
                    external_event_id=f"message:{mid}",
                    event_type="message",
                    data=message.model_dump(mode="json"),
                )
            )
        for change in entry.changes:
            if not change.value.id:
                continue
            items.append(
                ParsedItem(
                    external_account_id=entry.id,
                    external_event_id=f"{change.field}:{change.value.id}",
                    event_type=change.field,
                    data=change.value.model_dump(mode="json", by_alias=True),
                )
            )
    return items
