import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from cryptography.fernet import Fernet

from app.config.settings import get_settings
from app.services.instagram.capabilities import Capabilities, Feature
from app.services.instagram.client import GraphInstagramApi, InstagramApiError
from app.services.instagram.crypto import TokenCipher, TokenDecryptionError

TOKEN = "IGQ-secret-token"


def _api(handler: httpx.MockTransport) -> GraphInstagramApi:
    return GraphInstagramApi(httpx.AsyncClient(transport=handler), get_settings())


def test_cipher_round_trip_and_ciphertext_hides_token() -> None:
    key = Fernet.generate_key().decode()
    cipher = TokenCipher(key, [])
    encrypted = cipher.encrypt(TOKEN)
    assert TOKEN.encode() not in encrypted
    assert cipher.decrypt(encrypted) == TOKEN


def test_cipher_decrypts_with_previous_key_after_rotation() -> None:
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    encrypted = TokenCipher(old, []).encrypt(TOKEN)
    assert TokenCipher(new, [old]).decrypt(encrypted) == TOKEN
    with pytest.raises(TokenDecryptionError):
        TokenCipher(new, []).decrypt(encrypted)


def test_unsupported_capabilities_cannot_be_enabled() -> None:
    capabilities = Capabilities(get_settings())
    for feature in (
        Feature.COMMENT_LIKE,
        Feature.PROFILE_BIO_UPDATE,
        Feature.PROFILE_PHOTO_UPDATE,
    ):
        assert not capabilities.is_enabled(feature)
    assert capabilities.is_enabled(Feature.DM_REPLY)


def test_authorization_url_uses_configured_app_scopes_and_state() -> None:
    api = _api(httpx.MockTransport(lambda _: httpx.Response(200)))
    url = urlparse(api.authorization_url("state-123"))
    query = parse_qs(url.query)
    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://www.instagram.com/oauth/authorize"
    assert query["state"] == ["state-123"]
    assert query["response_type"] == ["code"]
    assert "instagram_business_manage_messages" in query["scope"][0]
    assert "test-app-secret" not in url.query


async def test_exchange_code_reads_both_response_shapes() -> None:
    legacy = {"access_token": "t", "user_id": 1, "permissions": "a,b"}
    for body in (legacy, {"data": [legacy]}):
        api = _api(httpx.MockTransport(lambda _, b=body: httpx.Response(200, json=b)))
        token = await api.exchange_code("code")
        assert (token.access_token, token.user_id, token.permissions) == ("t", "1", ["a", "b"])


async def test_dm_uses_bearer_header_and_never_puts_token_in_url() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"recipient_id": "9", "message_id": "mid-1"})

    api = _api(httpx.MockTransport(handler))
    assert await api.send_dm(TOKEN, "17841", "555", "Hello") == "mid-1"
    request = seen[0]
    assert request.headers["Authorization"] == f"Bearer {TOKEN}"
    assert TOKEN not in str(request.url)
    assert request.url.path.endswith("/17841/messages")
    assert json.loads(request.content) == {"recipient": {"id": "555"}, "message": {"text": "Hello"}}


async def test_private_reply_targets_comment_id() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["recipient"] == {"comment_id": "c-1"}
        return httpx.Response(200, json={"message_id": "mid-2"})

    assert await _api(httpx.MockTransport(handler)).send_private_reply(TOKEN, "1", "c-1", "Hi")


@pytest.mark.parametrize(
    ("status", "body", "token", "rate", "retry"),
    [
        (400, {"error": {"code": 190, "message": "expired"}}, True, False, False),
        (400, {"error": {"code": 4, "message": "app limit"}}, False, True, True),
        (429, {}, False, True, True),
        (500, {}, False, False, True),
        (400, {"error": {"code": 100, "message": "bad param"}}, False, False, False),
    ],
)
async def test_errors_are_classified(
    status: int, body: dict[str, object], token: bool, rate: bool, retry: bool
) -> None:
    api = _api(httpx.MockTransport(lambda _: httpx.Response(status, json=body)))
    with pytest.raises(InstagramApiError) as exc:
        await api.get_profile(TOKEN)
    assert (exc.value.is_token_error, exc.value.is_rate_limited, exc.value.is_retryable) == (
        token,
        rate,
        retry,
    )


async def test_transport_failure_is_retryable() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(InstagramApiError) as exc:
        await _api(httpx.MockTransport(handler)).get_profile(TOKEN)
    assert exc.value.is_retryable and exc.value.status_code == 0
