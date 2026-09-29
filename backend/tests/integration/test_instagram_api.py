import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest_asyncio
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.core.security import Identity
from app.main import create_app
from app.models.base import utcnow
from app.models.enums import InstagramAccountStatus, MemberRole
from app.models.identity import Organization, OrganizationMember, User
from app.models.instagram import InstagramAccount
from app.models.ops import AuditLog
from app.services.instagram.client import (
    InstagramApiError,
    InstagramProfile,
    LongLivedToken,
    ShortLivedToken,
)
from app.services.instagram.crypto import TokenCipher
from app.workers.maintenance import refresh_instagram_tokens

PLAINTEXT_TOKEN = "IGQ-long-lived-plaintext"


class FakeInstagramApi:
    def __init__(self) -> None:
        self.ig_user_id = "17841000"
        self.account_type = "BUSINESS"
        self.subscribe_fails = False
        self.refresh_error: InstagramApiError | None = None
        self.refreshed_tokens: list[str] = []

    def authorization_url(self, state: str) -> str:
        return f"https://www.instagram.com/oauth/authorize?state={state}"

    async def exchange_code(self, code: str) -> ShortLivedToken:
        return ShortLivedToken("short", self.ig_user_id, ["instagram_business_basic"])

    async def exchange_long_lived(self, short_token: str) -> LongLivedToken:
        return LongLivedToken(PLAINTEXT_TOKEN, utcnow() + timedelta(days=60))

    async def refresh_token(self, token: str) -> LongLivedToken:
        self.refreshed_tokens.append(token)
        if self.refresh_error:
            raise self.refresh_error
        return LongLivedToken("IGQ-refreshed", utcnow() + timedelta(days=60))

    async def get_profile(self, token: str) -> InstagramProfile:
        return InstagramProfile(self.ig_user_id, "acme", self.account_type)

    async def subscribe_webhooks(self, token: str) -> None:
        if self.subscribe_fails:
            raise InstagramApiError("nope", status_code=400, code=100)

    async def send_dm(self, token: str, account_id: str, recipient_id: str, text: str) -> str:
        raise NotImplementedError

    async def send_private_reply(
        self, token: str, account_id: str, comment_id: str, text: str
    ) -> str:
        raise NotImplementedError

    async def reply_to_comment(self, token: str, comment_id: str, text: str) -> str:
        raise NotImplementedError


class FakeVerifier:
    async def verify(self, token: str) -> Identity:
        return Identity(clerk_user_id=token, session_id=None)


@pytest_asyncio.fixture
async def fake_api() -> FakeInstagramApi:
    return FakeInstagramApi()


@pytest_asyncio.fixture
async def cipher() -> TokenCipher:
    return TokenCipher.from_settings(get_settings())


@pytest_asyncio.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    fake_api: FakeInstagramApi,
    cipher: TokenCipher,
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()
    app.state.session_factory = session_factory
    app.state.redis = redis
    app.state.token_verifier = FakeVerifier()
    app.state.instagram_api = fake_api
    app.state.token_cipher = cipher
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


def _auth(user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {user}"}


async def _org_owner(client: httpx.AsyncClient) -> str:
    user = f"user_{uuid.uuid4().hex[:12]}"
    response = await client.post(
        "/api/v1/organizations",
        json={"name": "Acme", "account_type": "creator"},
        headers=_auth(user),
    )
    assert response.status_code == 201
    return user


async def _connect(client: httpx.AsyncClient, user: str) -> httpx.Response:
    start = await client.post("/api/v1/instagram/oauth/start", headers=_auth(user))
    assert start.status_code == 200, start.text
    state = parse_qs(urlparse(start.json()["authorization_url"]).query)["state"][0]
    return await client.get(f"/api/v1/instagram/oauth/callback?code=abc&state={state}")


def _reason(response: httpx.Response) -> dict[str, list[str]]:
    assert response.status_code == 303
    return parse_qs(urlparse(response.headers["location"]).query)


async def test_full_connect_flow_stores_encrypted_token_and_lists_account(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    cipher: TokenCipher,
    fake_api: FakeInstagramApi,
) -> None:
    fake_api.ig_user_id = f"ig-{uuid.uuid4().hex[:10]}"
    user = await _org_owner(client)
    assert _reason(await _connect(client, user)) == {"status": ["connected"]}

    listing = (await client.get("/api/v1/instagram/accounts", headers=_auth(user))).json()
    (account_out,) = listing["items"]
    assert account_out["username"] == "acme" and account_out["webhook_subscribed"] is True
    assert "token" not in " ".join(account_out).lower().replace("token_expires_at", "")

    async with session_factory() as session:
        row = (
            await session.execute(
                select(InstagramAccount).where(
                    InstagramAccount.external_account_id == fake_api.ig_user_id
                )
            )
        ).scalar_one()
        assert PLAINTEXT_TOKEN.encode() not in row.access_token_encrypted
        assert cipher.decrypt(row.access_token_encrypted) == PLAINTEXT_TOKEN
        audit = (
            (
                await session.execute(
                    select(AuditLog.action).where(AuditLog.organization_id == row.organization_id)
                )
            )
            .scalars()
            .all()
        )
    assert "instagram.connected" in audit


async def test_state_is_single_use_and_unknown_state_is_rejected(
    client: httpx.AsyncClient, fake_api: FakeInstagramApi
) -> None:
    fake_api.ig_user_id = f"ig-{uuid.uuid4().hex[:10]}"
    user = await _org_owner(client)
    start = await client.post("/api/v1/instagram/oauth/start", headers=_auth(user))
    state = parse_qs(urlparse(start.json()["authorization_url"]).query)["state"][0]
    first = await client.get(f"/api/v1/instagram/oauth/callback?code=abc&state={state}")
    replay = await client.get(f"/api/v1/instagram/oauth/callback?code=abc&state={state}")
    forged = await client.get("/api/v1/instagram/oauth/callback?code=abc&state=forged")
    assert _reason(first)["status"] == ["connected"]
    assert _reason(replay)["reason"] == ["INVALID_OAUTH_STATE"]
    assert _reason(forged)["reason"] == ["INVALID_OAUTH_STATE"]


async def test_user_denied_authorization_is_reported_without_connecting(
    client: httpx.AsyncClient,
) -> None:
    user = await _org_owner(client)
    start = await client.post("/api/v1/instagram/oauth/start", headers=_auth(user))
    state = parse_qs(urlparse(start.json()["authorization_url"]).query)["state"][0]
    denied = await client.get(f"/api/v1/instagram/oauth/callback?error=access_denied&state={state}")
    assert _reason(denied)["reason"] == ["AUTHORIZATION_DENIED"]
    listing = (await client.get("/api/v1/instagram/accounts", headers=_auth(user))).json()
    assert listing["items"] == []


async def test_personal_accounts_are_rejected(
    client: httpx.AsyncClient, fake_api: FakeInstagramApi
) -> None:
    fake_api.account_type = "PERSONAL"
    user = await _org_owner(client)
    assert _reason(await _connect(client, user))["reason"] == ["INSTAGRAM_ACCOUNT_NOT_PROFESSIONAL"]


async def test_account_cannot_be_connected_to_two_organizations(
    client: httpx.AsyncClient, fake_api: FakeInstagramApi
) -> None:
    fake_api.ig_user_id = f"ig-{uuid.uuid4().hex[:10]}"
    first, second = await _org_owner(client), await _org_owner(client)
    assert _reason(await _connect(client, first))["status"] == ["connected"]
    assert _reason(await _connect(client, second))["reason"] == ["ACCOUNT_ALREADY_CONNECTED"]


async def test_webhook_subscription_failure_is_reported_not_hidden(
    client: httpx.AsyncClient, fake_api: FakeInstagramApi
) -> None:
    fake_api.ig_user_id = f"ig-{uuid.uuid4().hex[:10]}"
    fake_api.subscribe_fails = True
    user = await _org_owner(client)
    assert _reason(await _connect(client, user))["status"] == ["connected"]
    (account,) = (await client.get("/api/v1/instagram/accounts", headers=_auth(user))).json()[
        "items"
    ]
    assert account["webhook_subscribed"] is False


async def test_disconnect_wipes_token_and_reconnect_restores_same_account(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    fake_api: FakeInstagramApi,
) -> None:
    fake_api.ig_user_id = f"ig-{uuid.uuid4().hex[:10]}"
    user = await _org_owner(client)
    await _connect(client, user)
    (account,) = (await client.get("/api/v1/instagram/accounts", headers=_auth(user))).json()[
        "items"
    ]
    url = f"/api/v1/instagram/accounts/{account['id']}"
    assert (await client.delete(url, headers=_auth(user))).status_code == 204
    async with session_factory() as session:
        row = await session.get(InstagramAccount, uuid.UUID(account["id"]))
        assert row is not None
        assert (
            row.status is InstagramAccountStatus.DISCONNECTED and row.access_token_encrypted == b""
        )

    await _connect(client, user)
    (again,) = (await client.get("/api/v1/instagram/accounts", headers=_auth(user))).json()["items"]
    assert again["id"] == account["id"] and again["status"] == "active"


async def test_other_tenants_cannot_disconnect_or_see_accounts(
    client: httpx.AsyncClient, fake_api: FakeInstagramApi
) -> None:
    fake_api.ig_user_id = f"ig-{uuid.uuid4().hex[:10]}"
    owner, outsider = await _org_owner(client), await _org_owner(client)
    await _connect(client, owner)
    (account,) = (await client.get("/api/v1/instagram/accounts", headers=_auth(owner))).json()[
        "items"
    ]
    assert (await client.get("/api/v1/instagram/accounts", headers=_auth(outsider))).json()[
        "items"
    ] == []
    response = await client.delete(
        f"/api/v1/instagram/accounts/{account['id']}", headers=_auth(outsider)
    )
    assert response.status_code == 404


async def test_staff_cannot_start_connection(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = await _org_owner(client)
    org_id = (await client.get("/api/v1/organizations", headers=_auth(owner))).json()["items"][0][
        "id"
    ]
    staff = f"user_{uuid.uuid4().hex[:12]}"
    async with session_factory() as session:
        user = User(clerk_user_id=staff)
        session.add(user)
        await session.flush()
        session.add(
            OrganizationMember(
                organization_id=uuid.UUID(org_id), user_id=user.id, role=MemberRole.STAFF
            )
        )
        await session.commit()
    response = await client.post("/api/v1/instagram/oauth/start", headers=_auth(staff))
    assert response.status_code == 403


async def test_oauth_callback_rechecks_permission_if_role_changed_after_start(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    fake_api: FakeInstagramApi,
) -> None:
    fake_api.ig_user_id = f"ig-{uuid.uuid4().hex[:10]}"
    owner = await _org_owner(client)
    org_id = (await client.get("/api/v1/organizations", headers=_auth(owner))).json()["items"][0][
        "id"
    ]
    start = await client.post("/api/v1/instagram/oauth/start", headers=_auth(owner))
    state = parse_qs(urlparse(start.json()["authorization_url"]).query)["state"][0]

    # Owner is demoted to STAFF after starting the flow but before Meta redirects back.
    async with session_factory() as session:
        member = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == uuid.UUID(org_id)
                )
            )
        ).scalar_one()
        member.role = MemberRole.STAFF
        await session.commit()

    response = await client.get(f"/api/v1/instagram/oauth/callback?code=abc&state={state}")
    assert _reason(response)["reason"] == ["PERMISSION_DENIED"]
    listing = (await client.get("/api/v1/instagram/accounts", headers=_auth(owner))).json()
    assert listing["items"] == []


async def test_capabilities_report_unsupported_features_as_disabled(
    client: httpx.AsyncClient,
) -> None:
    user = await _org_owner(client)
    items = (await client.get("/api/v1/instagram/capabilities", headers=_auth(user))).json()
    flags = {item["feature"]: item["enabled"] for item in items}
    assert flags["FEATURE_COMMENT_LIKE"] is False and flags["FEATURE_DM_REPLY"] is True


async def test_token_refresh_renews_flags_expired_and_defers_transient_failures(
    session_factory: async_sessionmaker[AsyncSession],
    fake_api: FakeInstagramApi,
    cipher: TokenCipher,
) -> None:
    async with session_factory() as session:
        org_id = uuid.uuid4()
        session.add(Organization(id=org_id, name="T", account_type="creator"))
        await session.flush()
        ids: dict[str, uuid.UUID] = {}
        for name, expires in {
            "soon": timedelta(days=2),
            "expired": timedelta(days=-1),
            "far": timedelta(days=50),
        }.items():
            account = InstagramAccount(
                organization_id=org_id,
                external_account_id=f"ig-{uuid.uuid4().hex[:10]}",
                username=name,
                status=InstagramAccountStatus.ACTIVE,
                access_token_encrypted=cipher.encrypt(f"token-{name}"),
                token_expires_at=utcnow() + expires,
                granted_permissions=[],
            )
            session.add(account)
            await session.flush()
            ids[name] = account.id
        await session.commit()

    ctx = {
        "session_factory": session_factory,
        "settings": get_settings(),
        "instagram_api": fake_api,
        "token_cipher": cipher,
    }
    await refresh_instagram_tokens(ctx)

    async with session_factory() as session:
        soon = await session.get(InstagramAccount, ids["soon"])
        expired = await session.get(InstagramAccount, ids["expired"])
        far = await session.get(InstagramAccount, ids["far"])
    assert soon is not None and expired is not None and far is not None
    assert cipher.decrypt(soon.access_token_encrypted) == "IGQ-refreshed"
    assert expired.status is InstagramAccountStatus.TOKEN_EXPIRED
    assert cipher.decrypt(far.access_token_encrypted) == "token-far"
    assert fake_api.refreshed_tokens == ["token-soon"]

    fake_api.refresh_error = InstagramApiError("bad", status_code=400, code=190)
    async with session_factory() as session:
        row = await session.get(InstagramAccount, ids["soon"])
        assert row is not None
        row.token_expires_at = utcnow() + timedelta(days=1)
        await session.commit()
    await refresh_instagram_tokens(ctx)
    async with session_factory() as session:
        row = await session.get(InstagramAccount, ids["soon"])
        assert row is not None and row.status is InstagramAccountStatus.TOKEN_EXPIRED
