"""End-to-end: webhook event -> customer/conversation/message rows -> inbox API -> human takeover
-> manual reply -> delivery via the Instagram queue."""

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest_asyncio
from arq import create_pool
from arq.connections import RedisSettings
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.core.security import Identity
from app.main import create_app
from app.models.enums import (
    AccountType,
    DeliveryStatus,
    InstagramAccountStatus,
    MemberRole,
    MessageDirection,
    MessageOrigin,
    ProcessingStatus,
)
from app.models.identity import Organization, OrganizationMember, User
from app.models.instagram import Conversation, Customer, InstagramAccount, Message, WebhookEvent
from app.models.ops import Job
from app.services.events import handlers  # noqa: F401 - registers handlers
from app.services.instagram.client import InstagramApiError, LongLivedToken
from app.services.instagram.crypto import TokenCipher
from app.workers.queue import JobQueue, process_webhook_event, send_instagram_message
from app.workers.runtime import tracked
from tests.integration.conftest import REDIS_URL


class FakeVerifier:
    async def verify(self, token: str) -> Identity:
        return Identity(clerk_user_id=token, session_id=None)


class FakeInstagramApi:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []
        self.fail_with: InstagramApiError | None = None

    async def send_dm(self, token: str, account_id: str, recipient_id: str, text: str) -> str:
        if self.fail_with:
            raise self.fail_with
        self.sent.append((account_id, recipient_id, text))
        return f"mid-out-{len(self.sent)}"

    async def authorization_url(self, state: str) -> str:  # pragma: no cover
        raise NotImplementedError

    async def exchange_code(self, code: str) -> None:  # pragma: no cover
        raise NotImplementedError

    async def exchange_long_lived(self, short_token: str) -> LongLivedToken:  # pragma: no cover
        raise NotImplementedError

    async def refresh_token(self, token: str) -> LongLivedToken:  # pragma: no cover
        raise NotImplementedError

    async def get_profile(self, token: str) -> None:  # pragma: no cover
        raise NotImplementedError

    async def subscribe_webhooks(self, token: str) -> None:  # pragma: no cover
        raise NotImplementedError

    async def send_private_reply(
        self, token: str, account_id: str, comment_id: str, text: str
    ) -> str:
        raise NotImplementedError

    async def reply_to_comment(self, token: str, comment_id: str, text: str) -> str:
        raise NotImplementedError


@pytest_asyncio.fixture
async def cipher() -> TokenCipher:
    return TokenCipher.from_settings(get_settings())


@pytest_asyncio.fixture
async def fake_api() -> FakeInstagramApi:
    return FakeInstagramApi()


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
    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    app.state.job_queue = JobQueue(pool, session_factory)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http
    await pool.aclose()


def _auth(user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {user}"}


async def _org_and_account(
    session_factory: async_sessionmaker[AsyncSession], cipher: TokenCipher
) -> tuple[str, uuid.UUID, uuid.UUID, str]:
    owner = f"user_{uuid.uuid4().hex[:12]}"
    external_account_id = f"ig-{uuid.uuid4().hex[:10]}"
    async with session_factory() as session:
        org = Organization(name="T", account_type=AccountType.CREATOR)
        session.add(org)
        await session.flush()
        user = User(clerk_user_id=owner)
        session.add(user)
        await session.flush()
        session.add(
            OrganizationMember(organization_id=org.id, user_id=user.id, role=MemberRole.OWNER)
        )
        account = InstagramAccount(
            organization_id=org.id,
            external_account_id=external_account_id,
            username="acme",
            status=InstagramAccountStatus.ACTIVE,
            access_token_encrypted=cipher.encrypt("plaintext-token"),
            granted_permissions=[],
        )
        session.add(account)
        await session.commit()
        return owner, org.id, account.id, external_account_id


async def _deliver_inbound_message(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    org_id: uuid.UUID,
    account_id: uuid.UUID,
    account_external_id: str,
    sender_external_id: str,
    mid: str,
    text: str,
) -> None:
    """Simulates a webhook event already persisted (Phase 7-8) and run through the EVENTS worker.

    Mirrors the real receiver's `ON CONFLICT (external_event_id) DO NOTHING` so a redelivered
    `mid` (same test calling this twice) is a no-op here too, exactly as it is in production.
    """
    external_event_id = f"message:{mid}"
    async with session_factory() as session:
        result = await session.execute(
            insert(WebhookEvent)
            .values(
                organization_id=org_id,
                instagram_account_id=account_id,
                external_event_id=external_event_id,
                event_type="message",
                payload_hash="h",
                payload_json={
                    "sender": {"id": sender_external_id},
                    "recipient": {"id": account_external_id},
                    "message": {"mid": mid, "text": text},
                },
                status=ProcessingStatus.PENDING,
            )
            .on_conflict_do_nothing(index_elements=[WebhookEvent.external_event_id])
            .returning(WebhookEvent.id)
        )
        row = result.first()
        if row is None:
            return  # already delivered; the real receiver would also no-op here
        event_id = row.id
        job = Job(
            organization_id=org_id,
            queue="events",
            kind="process_webhook_event",
            status=ProcessingStatus.PENDING,
            payload={"webhook_event_id": str(event_id)},
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    from app.core.retry import RetryPolicy

    ctx: dict[str, Any] = {
        "session_factory": session_factory,
        "settings": get_settings(),
        "retry_policy": RetryPolicy(3, 1.0, 8.0),
        "job_try": 1,
        "redis": redis,
    }
    await tracked(process_webhook_event)(ctx, str(job_id))


async def test_inbound_message_creates_customer_conversation_and_message(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    cipher: TokenCipher,
) -> None:
    owner, org_id, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    sender = f"cust-{uuid.uuid4().hex[:8]}"
    await _deliver_inbound_message(
        session_factory,
        redis,
        org_id,
        account_id,
        account_external_id,
        sender,
        f"mid-{uuid.uuid4().hex[:8]}",
        "Hi there",
    )

    listing = (await client.get("/api/v1/conversations", headers=_auth(owner))).json()
    assert len(listing["items"]) == 1
    conversation = listing["items"][0]
    assert (
        conversation["unread_count"] == 1 and conversation["customer"]["external_user_id"] == sender
    )

    messages = (
        await client.get(
            f"/api/v1/conversations/{conversation['id']}/messages", headers=_auth(owner)
        )
    ).json()["items"]
    assert len(messages) == 1
    assert messages[0] == {
        **messages[0],
        "body": "Hi there",
        "direction": "inbound",
        "origin": "customer",
        "status": "received",
    }


async def test_second_message_reuses_same_conversation_and_dedupes_redelivery(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis, cipher: TokenCipher
) -> None:
    _, org_id, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    sender = f"cust-{uuid.uuid4().hex[:8]}"
    mid_a, mid_b = f"mid-{uuid.uuid4().hex[:8]}", f"mid-{uuid.uuid4().hex[:8]}"
    await _deliver_inbound_message(
        session_factory, redis, org_id, account_id, account_external_id, sender, mid_a, "First"
    )
    await _deliver_inbound_message(
        session_factory, redis, org_id, account_id, account_external_id, sender, mid_b, "Second"
    )
    # Redelivery of the first event (same external mid) must not create a duplicate message.
    await _deliver_inbound_message(
        session_factory, redis, org_id, account_id, account_external_id, sender, mid_a, "First"
    )
    async with session_factory() as session:
        conversations = (
            (
                await session.execute(
                    select(Conversation).where(Conversation.organization_id == org_id)
                )
            )
            .scalars()
            .all()
        )
        messages = (
            (await session.execute(select(Message).where(Message.organization_id == org_id)))
            .scalars()
            .all()
        )
    assert len(conversations) == 1
    assert len(messages) == 2
    assert conversations[0].unread_count == 2


async def test_our_own_echoed_message_is_not_recorded_as_inbound(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis, cipher: TokenCipher
) -> None:
    _, org_id, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    # sender == our own account id: this is an echo of something we sent, not a customer message.
    await _deliver_inbound_message(
        session_factory,
        redis,
        org_id,
        account_id,
        account_external_id,
        account_external_id,
        f"mid-{uuid.uuid4().hex[:8]}",
        "our reply",
    )
    async with session_factory() as session:
        assert (
            await session.execute(
                select(Conversation).where(Conversation.organization_id == org_id)
            )
        ).first() is None
        assert (
            await session.execute(select(Message).where(Message.organization_id == org_id))
        ).first() is None


async def test_staff_sees_only_assigned_conversations(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    cipher: TokenCipher,
) -> None:
    owner, org_id, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    sender = f"cust-{uuid.uuid4().hex[:8]}"
    await _deliver_inbound_message(
        session_factory,
        redis,
        org_id,
        account_id,
        account_external_id,
        sender,
        f"mid-{uuid.uuid4().hex[:8]}",
        "Hi",
    )
    staff = f"user_{uuid.uuid4().hex[:12]}"
    async with session_factory() as session:
        user = User(clerk_user_id=staff)
        session.add(user)
        await session.flush()
        session.add(
            OrganizationMember(organization_id=org_id, user_id=user.id, role=MemberRole.STAFF)
        )
        await session.commit()

    unassigned = (await client.get("/api/v1/conversations", headers=_auth(staff))).json()
    assert unassigned["items"] == []

    conv_id = (await client.get("/api/v1/conversations", headers=_auth(owner))).json()["items"][0][
        "id"
    ]
    async with session_factory() as session:
        conversation = await session.get(Conversation, uuid.UUID(conv_id))
        assert conversation is not None
        async with session_factory() as session2:
            staff_user = (
                await session2.execute(select(User).where(User.clerk_user_id == staff))
            ).scalar_one()
        conversation.assigned_user_id = staff_user.id
        await session.commit()

    assigned = (await client.get("/api/v1/conversations", headers=_auth(staff))).json()
    assert len(assigned["items"]) == 1
    not_found = await client.get(f"/api/v1/conversations/{conv_id}", headers=_auth(staff))
    assert not_found.status_code == 200
    forbidden_id = str(uuid.uuid4())
    denied = await client.get(f"/api/v1/conversations/{forbidden_id}", headers=_auth(staff))
    assert denied.status_code == 404


async def test_manual_reply_requires_takeover_and_delivers_through_instagram_queue(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    cipher: TokenCipher,
    fake_api: FakeInstagramApi,
) -> None:
    owner, org_id, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    sender = f"cust-{uuid.uuid4().hex[:8]}"
    await _deliver_inbound_message(
        session_factory,
        redis,
        org_id,
        account_id,
        account_external_id,
        sender,
        f"mid-{uuid.uuid4().hex[:8]}",
        "Hi",
    )
    conv_id = (await client.get("/api/v1/conversations", headers=_auth(owner))).json()["items"][0][
        "id"
    ]

    denied = await client.post(
        f"/api/v1/conversations/{conv_id}/messages", json={"body": "Hello!"}, headers=_auth(owner)
    )
    assert (
        denied.status_code == 409
        and denied.json()["error"]["code"] == "CONVERSATION_NOT_HUMAN_CONTROLLED"
    )

    takeover = await client.post(f"/api/v1/conversations/{conv_id}/takeover", headers=_auth(owner))
    assert takeover.status_code == 200 and takeover.json()["state"] == "human_active"

    sent = await client.post(
        f"/api/v1/conversations/{conv_id}/messages", json={"body": "Hello!"}, headers=_auth(owner)
    )
    assert sent.status_code == 201
    message_payload = sent.json()
    assert message_payload["status"] == "pending" and message_payload["origin"] == "human"

    async with session_factory() as session:
        job = (
            await session.execute(select(Job).where(Job.kind == "send_instagram_message"))
        ).scalar_one()

    from app.core.retry import RetryPolicy

    ctx: dict[str, Any] = {
        "session_factory": session_factory,
        "settings": get_settings(),
        "retry_policy": RetryPolicy(3, 1.0, 8.0),
        "job_try": 1,
        "instagram_api": fake_api,
        "token_cipher": cipher,
    }
    await tracked(send_instagram_message)(ctx, str(job.id))

    assert fake_api.sent == [(account_external_id, sender, "Hello!")]
    async with session_factory() as session:
        message = await session.get(Message, uuid.UUID(message_payload["id"]))
        assert message is not None
        assert message.status is DeliveryStatus.SENT and message.external_message_id == "mid-out-1"


async def test_rate_limited_send_is_retried_not_marked_failed(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    cipher: TokenCipher,
    fake_api: FakeInstagramApi,
) -> None:
    _, org_id, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    sender = f"cust-{uuid.uuid4().hex[:8]}"
    await _deliver_inbound_message(
        session_factory,
        redis,
        org_id,
        account_id,
        account_external_id,
        sender,
        f"mid-{uuid.uuid4().hex[:8]}",
        "Hi",
    )
    async with session_factory() as session:
        conversation = (
            await session.execute(
                select(Conversation).where(Conversation.organization_id == org_id)
            )
        ).scalar_one()
        conversation.state = "human_active"  # type: ignore[assignment]
        customer = await session.get(Customer, conversation.customer_id)
        assert customer is not None
        message = Message(
            organization_id=org_id,
            instagram_account_id=account_id,
            conversation_id=conversation.id,
            direction=MessageDirection.OUTBOUND,
            origin=MessageOrigin.HUMAN,
            body="retry me",
            status=DeliveryStatus.PENDING,
        )
        session.add(message)
        await session.commit()
        message_id = message.id

    fake_api.fail_with = InstagramApiError("busy", status_code=429, code=4)
    from arq import Retry

    from app.core.retry import RetryPolicy

    ctx: dict[str, Any] = {
        "session_factory": session_factory,
        "settings": get_settings(),
        "retry_policy": RetryPolicy(3, 1.0, 8.0),
        "job_try": 1,
        "instagram_api": fake_api,
        "token_cipher": cipher,
    }
    async with session_factory() as session:
        job = Job(
            organization_id=org_id,
            queue="instagram",
            kind="send_instagram_message",
            status=ProcessingStatus.PENDING,
            payload={
                "message_id": str(message_id),
                "instagram_account_id": str(account_id),
                "recipient_external_id": sender,
            },
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    try:
        await tracked(send_instagram_message)(ctx, str(job_id))
        raised = False
    except Retry:
        raised = True
    assert raised
    async with session_factory() as session:
        message = await session.get(Message, message_id)
        assert message is not None and message.status is DeliveryStatus.PENDING


async def test_dm_disabled_capability_suppresses_without_calling_instagram(
    session_factory: async_sessionmaker[AsyncSession],
    cipher: TokenCipher,
    fake_api: FakeInstagramApi,
    monkeypatch: Any,
) -> None:
    _, org_id, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    monkeypatch.setenv("FEATURE_DM_REPLY", "false")
    get_settings.cache_clear()
    async with session_factory() as session:
        org = await session.get(Organization, org_id)
        assert org is not None
        customer = Customer(
            organization_id=org_id, instagram_account_id=account_id, external_user_id="c1"
        )
        session.add(customer)
        await session.flush()
        conversation = Conversation(
            organization_id=org_id,
            instagram_account_id=account_id,
            customer_id=customer.id,
            state="human_active",  # type: ignore[arg-type]
        )
        session.add(conversation)
        await session.flush()
        message = Message(
            organization_id=org_id,
            instagram_account_id=account_id,
            conversation_id=conversation.id,
            direction=MessageDirection.OUTBOUND,
            origin=MessageOrigin.HUMAN,
            body="hi",
            status=DeliveryStatus.PENDING,
        )
        session.add(message)
        await session.commit()
        message_id = message.id
        job = Job(
            organization_id=org_id,
            queue="instagram",
            kind="send_instagram_message",
            status=ProcessingStatus.PENDING,
            payload={
                "message_id": str(message_id),
                "instagram_account_id": str(account_id),
                "recipient_external_id": "c1",
            },
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    from app.core.retry import RetryPolicy

    ctx: dict[str, Any] = {
        "session_factory": session_factory,
        "settings": get_settings(),
        "retry_policy": RetryPolicy(3, 1.0, 8.0),
        "job_try": 1,
        "instagram_api": fake_api,
        "token_cipher": cipher,
    }
    await tracked(send_instagram_message)(ctx, str(job_id))
    get_settings.cache_clear()

    assert fake_api.sent == []
    async with session_factory() as session:
        message = await session.get(Message, message_id)
        assert message is not None and message.status is DeliveryStatus.SUPPRESSED


async def test_internal_note_is_recorded_but_never_queued_for_sending(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    cipher: TokenCipher,
) -> None:
    owner, org_id, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    sender = f"cust-{uuid.uuid4().hex[:8]}"
    await _deliver_inbound_message(
        session_factory,
        redis,
        org_id,
        account_id,
        account_external_id,
        sender,
        f"mid-{uuid.uuid4().hex[:8]}",
        "Hi",
    )
    conv_id = (await client.get("/api/v1/conversations", headers=_auth(owner))).json()["items"][0][
        "id"
    ]
    response = await client.post(
        f"/api/v1/conversations/{conv_id}/notes",
        json={"body": "called the warehouse"},
        headers=_auth(owner),
    )
    assert response.status_code == 201
    assert response.json()["origin"] == "internal_note"
    async with session_factory() as session:
        jobs = (
            (
                await session.execute(
                    select(Job).where(
                        Job.kind == "send_instagram_message", Job.organization_id == org_id
                    )
                )
            )
            .scalars()
            .all()
        )
    assert jobs == []
