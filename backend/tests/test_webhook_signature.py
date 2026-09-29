import pytest

from app.config.settings import get_settings
from app.services.instagram.webhooks import (
    WebhookVerificationError,
    extract_items,
    parse_payload,
    verify_challenge,
    verify_signature,
)

BODY = b'{"object":"instagram","entry":[{"id":"17841","time":1,"messaging":[]}]}'


def _sign(body: bytes) -> str:
    import hashlib
    import hmac

    secret = get_settings().meta_app_secret.get_secret_value()
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_valid_signature_is_accepted() -> None:
    assert verify_signature(get_settings(), BODY, _sign(BODY))


def test_tampered_body_is_rejected() -> None:
    assert not verify_signature(get_settings(), BODY.replace(b"17841", b"99999"), _sign(BODY))


def test_missing_or_malformed_header_is_rejected() -> None:
    assert not verify_signature(get_settings(), BODY, None)
    assert not verify_signature(get_settings(), BODY, "not-the-right-format")
    assert not verify_signature(get_settings(), BODY, "sha256=deadbeef")


def test_verify_challenge_accepts_matching_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("META_WEBHOOK_VERIFY_TOKEN", "expected-token")
    get_settings.cache_clear()
    verify_challenge(get_settings(), "subscribe", "expected-token")
    get_settings.cache_clear()


def test_verify_challenge_rejects_wrong_token_or_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("META_WEBHOOK_VERIFY_TOKEN", "expected-token")
    get_settings.cache_clear()
    with pytest.raises(WebhookVerificationError):
        verify_challenge(get_settings(), "subscribe", "wrong")
    with pytest.raises(WebhookVerificationError):
        verify_challenge(get_settings(), "unsubscribe", "expected-token")
    with pytest.raises(WebhookVerificationError):
        verify_challenge(get_settings(), "subscribe", None)
    get_settings.cache_clear()


def test_verify_challenge_fails_closed_when_no_token_configured() -> None:
    with pytest.raises(WebhookVerificationError):
        verify_challenge(get_settings(), "subscribe", "")


def test_extract_items_reads_messages_and_comments() -> None:
    payload = parse_payload(
        b'{"object":"instagram","entry":[{"id":"17841","time":1,'
        b'"messaging":[{"sender":{"id":"9"},"recipient":{"id":"17841"},"message":{"mid":"m1","text":"hi"}}],'
        b'"changes":[{"field":"comments","value":{"id":"c1","text":"nice post"}}]}]}'
    )
    items = extract_items(payload)
    kinds = {(i.event_type, i.external_event_id) for i in items}
    assert kinds == {("message", "message:m1"), ("comments", "comments:c1")}
    assert all(i.external_account_id == "17841" for i in items)


def test_extract_items_skips_incomplete_entries_without_raising() -> None:
    payload = parse_payload(
        b'{"object":"instagram","entry":[{"id":"17841","time":1,'
        b'"messaging":[{"sender":{"id":"9"}}],'
        b'"changes":[{"field":"comments","value":{"text":"no id here"}}]}]}'
    )
    assert extract_items(payload) == []


def test_parse_payload_rejects_malformed_json() -> None:
    with pytest.raises(ValueError, match="Malformed"):
        parse_payload(b"not json at all")


def test_parse_payload_tolerates_unknown_top_level_fields() -> None:
    payload = parse_payload(b'{"object":"instagram","entry":[],"unexpected_field":"value"}')
    assert payload.entry == []
