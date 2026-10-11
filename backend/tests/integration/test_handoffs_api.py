"""Human handoff lifecycle and queue on real PostgreSQL: handoffs follow takeover / hand-back /
resolve, the queue is tenant- and role-scoped, and concurrent requests open exactly one."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx
import pytest_asyncio
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.main import create_app
from app.models.enums import (
    ConversationState,
    HandoffReason,
    HandoffStatus,
    MemberRole,
)
from app.models.identity import User
from app.models.instagram import Conversation, InstagramAccount
from app.models.ops import AuditLog, HumanHandoff
from app.services.conversations.conversations import request_human_handoff
from app.services.instagram.crypto import TokenCipher
from tests.integration.test_conversations_flow import (
    FakeVerifier,
    _deliver_inbound_message,
    _org_and_account,
)
from tests.integration.test_knowledge_api import Org, _make_org

BASE = "/api/v1/handoffs"


@pytest_asyncio.fixture
async def app(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> AsyncIterator[FastAPI]:
    application = create_app()
    application.state.session_factory = session_factory
    application.state.redis = redis
    application.state.token_verifier = FakeVerifier()
    yield application


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        yield http


@dataclass
class Shop:
    org: Org
    account_id: uuid.UUID
    account_external_id: str
    factory: async_sessionmaker[AsyncSession]
    redis: Redis

    async def conversation(self, text: str = "hello") -> uuid.UUID:
        """A new customer conversation (via the real inbound path); returns its id."""
        sender = f"cust-{uuid.uuid4().hex[:8]}"
        await _deliver_inbound_message(
            self.factory,
            self.redis,
            self.org.id,
            self.account_id,
            self.account_external_id,
            sender,
            f"mid-{uuid.uuid4().hex[:8]}",
            text,
        )
        async with self.factory() as session:
            return (
                await session.execute(
                    select(Conversation.id)
                    .where(Conversation.organization_id == self.org.id)
                    .order_by(Conversation.created_at.desc())
                    .limit(1)
                )
            ).scalar_one()

    async def raise_handoff(
        self, conversation_id: uuid.UUID, reason: HandoffReason = HandoffReason.LOW_CONFIDENCE
    ) -> None:
        async with self.factory() as session:
            conversation = await session.get(Conversation, conversation_id)
            assert conversation is not None
            await request_human_handoff(session, conversation, self.org.id, reason)
            await session.commit()

    async def handoffs(self, conversation_id: uuid.UUID | None = None) -> list[HumanHandoff]:
        async with self.factory() as session:
            stmt = select(HumanHandoff).where(HumanHandoff.organization_id == self.org.id)
            if conversation_id is not None:
                stmt = stmt.where(HumanHandoff.conversation_id == conversation_id)
            return list((await session.execute(stmt.order_by(HumanHandoff.created_at))).scalars())

    async def user_id(self, role: MemberRole) -> uuid.UUID:
        async with self.factory() as session:
            return (
                await session.execute(
                    select(User.id).where(User.clerk_user_id == self.org.users[role])
                )
            ).scalar_one()

    async def conversation_state(self, conversation_id: uuid.UUID) -> ConversationState:
        async with self.factory() as session:
            conversation = await session.get(Conversation, conversation_id)
            assert conversation is not None
            return conversation.state

    async def assign(self, conversation_id: uuid.UUID, role: MemberRole) -> None:
        user_id = await self.user_id(role)
        async with self.factory() as session:
            await session.execute(
                update(Conversation)
                .where(Conversation.id == conversation_id)
                .values(assigned_user_id=user_id)
            )
            await session.commit()


async def _shop(
    factory: async_sessionmaker[AsyncSession], redis: Redis, cipher: TokenCipher
) -> Shop:
    org = await _make_org(factory)
    _, _, account_id, external_id = await _org_and_account(factory, cipher)
    async with factory() as session:  # attach the account to the org that has all four roles
        account = await session.get(InstagramAccount, account_id)
        assert account is not None
        account.organization_id = org.id
        await session.commit()
    return Shop(org, account_id, external_id, factory, redis)


@pytest_asyncio.fixture
async def shop(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis, cipher: TokenCipher
) -> Shop:
    return await _shop(session_factory, redis, cipher)


def _owner(shop: Shop) -> dict[str, str]:
    return shop.org.headers(MemberRole.OWNER)


# ---- lifecycle ----
async def test_takeover_assigns_the_open_handoff_to_the_person(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv = await shop.conversation()
    await shop.raise_handoff(conv)
    (opened,) = await shop.handoffs(conv)
    assert opened.status is HandoffStatus.OPEN and opened.assigned_user_id is None

    response = await client.post(f"/api/v1/conversations/{conv}/takeover", headers=_owner(shop))
    assert response.status_code == 200
    (assigned,) = await shop.handoffs(conv)
    assert assigned.status is HandoffStatus.ASSIGNED
    assert assigned.assigned_user_id == await shop.user_id(MemberRole.OWNER)
    assert assigned.resolved_at is None


async def test_handing_back_to_the_ai_resolves_the_handoff(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv = await shop.conversation()
    await shop.raise_handoff(conv)
    await client.post(f"/api/v1/conversations/{conv}/takeover", headers=_owner(shop))
    response = await client.post(f"/api/v1/conversations/{conv}/hand-back", headers=_owner(shop))
    assert response.json()["state"] == "ai_active"
    (done,) = await shop.handoffs(conv)
    assert done.status is HandoffStatus.RESOLVED and done.resolved_at is not None


async def test_resolving_the_conversation_resolves_an_unassigned_handoff(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv = await shop.conversation()
    await shop.raise_handoff(conv)
    response = await client.post(f"/api/v1/conversations/{conv}/resolve", headers=_owner(shop))
    assert response.json()["state"] == "resolved"
    (done,) = await shop.handoffs(conv)
    assert done.status is HandoffStatus.RESOLVED and done.resolved_at is not None


async def test_a_conversation_can_need_a_person_again_after_hand_back(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv = await shop.conversation()
    await shop.raise_handoff(conv, HandoffReason.LOW_CONFIDENCE)
    await client.post(f"/api/v1/conversations/{conv}/takeover", headers=_owner(shop))
    await client.post(f"/api/v1/conversations/{conv}/hand-back", headers=_owner(shop))
    await shop.raise_handoff(conv, HandoffReason.COMPLAINT)
    first, second = await shop.handoffs(conv)
    assert first.status is HandoffStatus.RESOLVED
    assert second.status is HandoffStatus.OPEN and second.reason is HandoffReason.COMPLAINT


async def test_a_resolved_handoff_is_not_reassigned_by_a_later_takeover(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv = await shop.conversation()
    await shop.raise_handoff(conv)
    await client.post(f"/api/v1/conversations/{conv}/resolve", headers=_owner(shop))
    await client.post(f"/api/v1/conversations/{conv}/takeover", headers=_owner(shop))
    (handoff,) = await shop.handoffs(conv)
    assert handoff.status is HandoffStatus.RESOLVED and handoff.assigned_user_id is None


async def test_taking_over_a_conversation_nobody_flagged_is_fine(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv = await shop.conversation()
    assert (
        await client.post(f"/api/v1/conversations/{conv}/takeover", headers=_owner(shop))
    ).status_code == 200
    assert await shop.handoffs(conv) == []


async def test_other_conversations_handoffs_are_untouched(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    first, second = await shop.conversation(), await shop.conversation()
    await shop.raise_handoff(first)
    await shop.raise_handoff(second)
    await client.post(f"/api/v1/conversations/{first}/takeover", headers=_owner(shop))
    (still_open,) = await shop.handoffs(second)
    assert still_open.status is HandoffStatus.OPEN


async def test_unrelated_edits_do_not_advance_a_handoff(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv = await shop.conversation()
    await shop.raise_handoff(conv)
    await client.patch(
        f"/api/v1/conversations/{conv}", headers=_owner(shop), json={"priority": "high"}
    )
    (handoff,) = await shop.handoffs(conv)
    assert handoff.status is HandoffStatus.OPEN


async def test_concurrent_requests_open_exactly_one_handoff(
    shop: Shop, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    conv = await shop.conversation()
    await asyncio.gather(
        *(
            shop.raise_handoff(
                conv, HandoffReason.THREAT if i % 2 else HandoffReason.LOW_CONFIDENCE
            )
            for i in range(10)
        )
    )
    assert len(await shop.handoffs(conv)) == 1
    async with session_factory() as session:
        audited = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.organization_id == shop.org.id,
                AuditLog.action == "conversation.human_required",
            )
        )
    assert audited == 1


async def test_requests_waiting_on_the_conversation_lock_open_exactly_one_handoff(
    shop: Shop,
) -> None:
    """Deterministic version of the race: hold the conversation row so every request is already
    waiting, then release. Without the lock each sees "AI active" and opens its own handoff."""
    conv = await shop.conversation()
    async with shop.factory() as holder:
        await holder.execute(select(Conversation).where(Conversation.id == conv).with_for_update())
        reasons = [HandoffReason.THREAT, HandoffReason.LOW_CONFIDENCE, HandoffReason.MANUAL]
        tasks = [asyncio.create_task(shop.raise_handoff(conv, reason)) for reason in reasons]
        await asyncio.sleep(0.5)  # all three are now past their reads, waiting on the row
        assert not any(task.done() for task in tasks)
        await holder.commit()
    await asyncio.gather(*tasks)
    (only,) = await shop.handoffs(conv)
    assert only.status is HandoffStatus.OPEN


# ---- the queue ----
async def test_queue_lists_unresolved_handoffs_oldest_first_with_the_customer(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    first, second, third = [await shop.conversation(f"msg {i}") for i in range(3)]
    for conv in (first, second, third):
        await shop.raise_handoff(conv)
    await client.post(f"/api/v1/conversations/{second}/takeover", headers=_owner(shop))
    await client.post(f"/api/v1/conversations/{third}/resolve", headers=_owner(shop))

    body = (await client.get(BASE, headers=_owner(shop))).json()
    assert [(i["conversation_id"], i["status"]) for i in body["items"]] == [
        (str(first), "open"),
        (str(second), "assigned"),
    ]
    item = body["items"][0]
    assert item["customer"]["external_user_id"].startswith("cust-")
    assert item["reason"] == "low_confidence" and item["conversation_state"] == "human_required"
    assert item["resolved_at"] is None and item["assigned_user_id"] is None


async def test_queue_status_filter_and_validation(client: httpx.AsyncClient, shop: Shop) -> None:
    open_conv, done_conv = await shop.conversation(), await shop.conversation()
    await shop.raise_handoff(open_conv)
    await shop.raise_handoff(done_conv)
    await client.post(f"/api/v1/conversations/{done_conv}/resolve", headers=_owner(shop))

    resolved = (await client.get(f"{BASE}?status=resolved", headers=_owner(shop))).json()
    assert [i["conversation_id"] for i in resolved["items"]] == [str(done_conv)]
    assert resolved["items"][0]["resolved_at"] is not None
    assert (await client.get(f"{BASE}?status=bogus", headers=_owner(shop))).status_code == 422
    assert (await client.get(f"{BASE}?limit=0", headers=_owner(shop))).status_code == 422


async def test_queue_pagination(client: httpx.AsyncClient, shop: Shop) -> None:
    convs = [await shop.conversation() for _ in range(3)]
    for conv in convs:
        await shop.raise_handoff(conv)
    page1 = (await client.get(f"{BASE}?limit=2", headers=_owner(shop))).json()
    assert len(page1["items"]) == 2 and page1["next_cursor"]
    page2 = (
        await client.get(f"{BASE}?limit=2&cursor={page1['next_cursor']}", headers=_owner(shop))
    ).json()
    seen = [i["conversation_id"] for i in page1["items"] + page2["items"]]
    assert seen == [str(c) for c in convs] and page2["next_cursor"] is None


async def test_counts_cover_only_unresolved_handoffs(client: httpx.AsyncClient, shop: Shop) -> None:
    assert (await client.get(f"{BASE}/counts", headers=_owner(shop))).json() == {
        "open": 0,
        "assigned": 0,
    }
    a, b, c = [await shop.conversation() for _ in range(3)]
    for conv in (a, b, c):
        await shop.raise_handoff(conv)
    await client.post(f"/api/v1/conversations/{b}/takeover", headers=_owner(shop))
    await client.post(f"/api/v1/conversations/{c}/resolve", headers=_owner(shop))
    assert (await client.get(f"{BASE}/counts", headers=_owner(shop))).json() == {
        "open": 1,
        "assigned": 1,
    }


# ---- scoping ----
async def test_staff_only_see_handoffs_on_conversations_assigned_to_them(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    mine, others = await shop.conversation(), await shop.conversation()
    await shop.raise_handoff(mine)
    await shop.raise_handoff(others)
    await shop.assign(mine, MemberRole.STAFF)

    staff = shop.org.headers(MemberRole.STAFF)
    assert [
        i["conversation_id"] for i in (await client.get(BASE, headers=staff)).json()["items"]
    ] == [str(mine)]
    assert (await client.get(f"{BASE}/counts", headers=staff)).json() == {"open": 1, "assigned": 0}
    for role in (MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MANAGER):
        everything = (await client.get(BASE, headers=shop.org.headers(role))).json()["items"]
        assert len(everything) == 2, role


async def test_a_deleted_conversation_leaves_the_queue(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    kept, deleted = await shop.conversation(), await shop.conversation()
    await shop.raise_handoff(kept)
    await shop.raise_handoff(deleted)
    async with shop.factory() as session:
        await session.execute(
            update(Conversation).where(Conversation.id == deleted).values(deleted_at=func.now())
        )
        await session.commit()
    items = (await client.get(BASE, headers=_owner(shop))).json()["items"]
    assert [i["conversation_id"] for i in items] == [str(kept)]
    assert (await client.get(f"{BASE}/counts", headers=_owner(shop))).json()["open"] == 1


async def test_other_organizations_never_see_the_queue(
    client: httpx.AsyncClient, shop: Shop, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    other = await _make_org(session_factory)
    conv = await shop.conversation()
    await shop.raise_handoff(conv)
    for role in MemberRole:
        assert (await client.get(BASE, headers=other.headers(role))).json()["items"] == []
        assert (await client.get(f"{BASE}/counts", headers=other.headers(role))).json() == {
            "open": 0,
            "assigned": 0,
        }
    stranger = {
        "Authorization": f"Bearer {other.users[MemberRole.OWNER]}",
        "X-Organization-ID": str(shop.org.id),
    }
    assert (await client.get(BASE, headers=stranger)).status_code in {403, 404}


async def test_the_queue_requires_authentication(client: httpx.AsyncClient) -> None:
    assert (await client.get(BASE)).status_code == 401
    assert (await client.get(f"{BASE}/counts")).status_code == 401


async def test_taking_over_in_another_organization_leaves_handoffs_alone(
    client: httpx.AsyncClient, shop: Shop, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    other = await _make_org(session_factory)
    conv = await shop.conversation()
    await shop.raise_handoff(conv)
    response = await client.post(
        f"/api/v1/conversations/{conv}/takeover", headers=other.headers(MemberRole.OWNER)
    )
    assert response.status_code == 404
    (handoff,) = await shop.handoffs(conv)
    assert handoff.status is HandoffStatus.OPEN and handoff.assigned_user_id is None
    assert (await shop.conversation_state(conv)) is ConversationState.HUMAN_REQUIRED
