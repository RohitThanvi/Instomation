"""Analytics overview and AI usage report on real PostgreSQL, with seeded data at fixed UTC
timestamps so every number, boundary and zero-filled day is checked exactly."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.main import create_app
from app.models.enums import (
    ConversationState,
    DeliveryStatus,
    HandoffReason,
    HandoffStatus,
    MemberRole,
    MessageDirection,
    MessageOrigin,
)
from app.models.instagram import Conversation, Message
from app.models.ops import AiUsage, HumanHandoff
from app.services.instagram.crypto import TokenCipher
from tests.integration.test_conversations_flow import FakeVerifier
from tests.integration.test_handoffs_api import Shop, _shop

OVERVIEW = "/api/v1/analytics/overview"
USAGE = "/api/v1/usage"
RANGE = {"from": "2026-03-10", "to": "2026-03-14"}  # five UTC days, end inclusive


def at(day: str, time: str = "12:00:00") -> datetime:
    return datetime.fromisoformat(f"{day}T{time}+00:00")


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


@pytest_asyncio.fixture
async def shop(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis, cipher: TokenCipher
) -> Shop:
    return await _shop(session_factory, redis, cipher)


async def _clear_messages(shop: Shop) -> None:
    """Drop what the inbound path created so tests control every row and timestamp."""
    async with shop.factory() as session:
        await session.execute(delete(Message).where(Message.organization_id == shop.org.id))
        await session.commit()


async def add_message(
    shop: Shop,
    conversation_id: uuid.UUID,
    when: datetime,
    *,
    direction: MessageDirection = MessageDirection.INBOUND,
    origin: MessageOrigin = MessageOrigin.CUSTOMER,
    status: DeliveryStatus = DeliveryStatus.RECEIVED,
    moderation: dict[str, Any] | None = None,
) -> None:
    async with shop.factory() as session:
        session.add(
            Message(
                organization_id=shop.org.id,
                instagram_account_id=shop.account_id,
                conversation_id=conversation_id,
                direction=direction,
                origin=origin,
                body="x",
                status=status,
                moderation=moderation,
                created_at=when,
            )
        )
        await session.commit()


async def add_usage(
    shop: Shop,
    when: datetime,
    *,
    purpose: str = "dm_reply",
    provider: str = "groq",
    model: str = "m1",
    tokens: tuple[int, int] = (100, 20),
    cost: str = "0.001000",
    latency: int = 200,
    status: str = "success",
    org_id: uuid.UUID | None = None,
) -> None:
    async with shop.factory() as session:
        session.add(
            AiUsage(
                organization_id=org_id or shop.org.id,
                provider=provider,
                model=model,
                purpose=purpose,
                input_tokens=tokens[0],
                output_tokens=tokens[1],
                estimated_cost=Decimal(cost),
                latency_ms=latency,
                status=status,
                created_at=when,
            )
        )
        await session.commit()


async def overview(client: httpx.AsyncClient, shop: Shop, **params: str) -> dict[str, Any]:
    response = await client.get(OVERVIEW, headers=shop.org.headers(), params=params or RANGE)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


# ---- overview ----
async def test_overview_counts_exactly_what_is_in_range(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv_a, conv_b = await shop.conversation(), await shop.conversation()
    await _clear_messages(shop)
    async with shop.factory() as session:
        await session.execute(
            update(Conversation)
            .where(Conversation.id == conv_a)
            .values(created_at=at("2026-03-11"), is_lead=True)
        )
        await session.execute(
            update(Conversation)
            .where(Conversation.id == conv_b)
            .values(created_at=at("2026-03-01"))
        )
        await session.commit()

    allow = {"action": "allow", "category": "clean", "source": "model", "confidence": 0.9}
    block = {"action": "block", "category": "spam", "source": "rules", "confidence": 1.0}
    escalate = {"action": "escalate", "category": "threat", "source": "model", "confidence": 0.9}
    out = MessageDirection.OUTBOUND
    # inside the range
    await add_message(shop, conv_a, at("2026-03-10"), moderation=allow)
    await add_message(shop, conv_a, at("2026-03-10", "08:00:00"), moderation=block)
    await add_message(shop, conv_a, at("2026-03-12"), moderation=escalate)
    await add_message(
        shop,
        conv_a,
        at("2026-03-12", "13:00:00"),
        direction=out,
        origin=MessageOrigin.AI,
        status=DeliveryStatus.SENT,
    )
    await add_message(
        shop,
        conv_a,
        at("2026-03-12", "14:00:00"),
        direction=out,
        origin=MessageOrigin.AI,
        status=DeliveryStatus.FAILED,
    )
    await add_message(
        shop,
        conv_b,
        at("2026-03-13"),
        direction=out,
        origin=MessageOrigin.HUMAN,
        status=DeliveryStatus.SENT,
    )
    await add_message(
        shop,
        conv_b,
        at("2026-03-13", "09:00:00"),
        direction=out,
        origin=MessageOrigin.INTERNAL_NOTE,
        status=DeliveryStatus.SENT,
    )
    # the two day boundaries are inclusive/exclusive exactly as documented
    await add_message(shop, conv_b, at("2026-03-10", "00:00:00"))  # first instant: in
    await add_message(shop, conv_b, at("2026-03-14", "23:59:59"))  # last second: in
    # outside the range
    await add_message(shop, conv_b, at("2026-03-09", "23:59:59"))
    await add_message(shop, conv_b, at("2026-03-15", "00:00:00"))
    await add_message(shop, conv_b, at("2026-02-01"), direction=out, origin=MessageOrigin.AI)

    async with shop.factory() as session:
        for reason, created, resolved in (
            (HandoffReason.THREAT, "2026-03-12", None),
            (HandoffReason.THREAT, "2026-03-13", "2026-03-14"),
            (HandoffReason.LOW_CONFIDENCE, "2026-03-10", None),
            (HandoffReason.MANUAL, "2026-03-02", "2026-03-11"),  # opened before, resolved inside
            (HandoffReason.MANUAL, "2026-03-20", None),  # after the range
        ):
            session.add(
                HumanHandoff(
                    organization_id=shop.org.id,
                    conversation_id=conv_a,
                    reason=reason,
                    status=HandoffStatus.RESOLVED if resolved else HandoffStatus.OPEN,
                    created_at=at(created),
                    resolved_at=at(resolved) if resolved else None,
                )
            )
        await session.commit()

    body = await overview(client, shop)
    assert body["range"] == {"start": "2026-03-10", "end": "2026-03-14"}
    assert body["conversations"]["new"] == 1 and body["conversations"]["new_leads"] == 1
    assert body["conversations"]["by_state"] == {
        "ai_active": 2,
        "human_required": 0,
        "human_active": 0,
        "resolved": 0,
    }
    # inbound in range: 3 moderated + the two boundary messages; the internal note is not counted
    assert body["messages"] == {
        "inbound": 5,
        "outbound_ai": 2,
        "outbound_human": 1,
        "outbound_failed": 1,
    }
    auto = body["automation"]
    assert auto["ai_replies_sent"] == 1
    assert auto["handoffs_opened"] == 3 and auto["handoffs_resolved"] == 2
    assert auto["handoffs_by_reason"]["threat"] == 2
    assert auto["handoffs_by_reason"]["low_confidence"] == 1
    assert auto["handoffs_by_reason"]["manual"] == 0  # its row was created outside the range
    assert body["moderation"] == {
        "allowed": 1,
        "blocked": 1,
        "escalated": 1,
        "blocked_by_category": {"spam": 1},
    }
    assert [(d["date"], d["inbound"], d["outbound"]) for d in body["daily"]] == [
        ("2026-03-10", 3, 0),  # the 00:00:00 boundary message + two seeded that day
        ("2026-03-11", 0, 0),  # zero-filled
        ("2026-03-12", 1, 2),
        ("2026-03-13", 0, 1),  # the internal note is excluded
        ("2026-03-14", 1, 0),  # 23:59:59 still belongs to the 14th
    ]


async def test_overview_with_no_data_is_all_zeros_with_a_full_daily_series(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    body = await overview(client, shop)
    assert body["messages"] == {
        "inbound": 0,
        "outbound_ai": 0,
        "outbound_human": 0,
        "outbound_failed": 0,
    }
    assert body["moderation"]["blocked_by_category"] == {}
    assert len(body["daily"]) == 5 and all(
        d["inbound"] == d["outbound"] == 0 for d in body["daily"]
    )
    assert all(v == 0 for v in body["automation"]["handoffs_by_reason"].values())


async def test_default_range_is_the_last_thirty_days_ending_today(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    body = (await client.get(OVERVIEW, headers=shop.org.headers())).json()
    today = datetime.now(UTC).date()
    assert body["range"]["end"] == today.isoformat() and len(body["daily"]) == 30
    assert body["daily"][0]["date"] == (today.fromordinal(today.toordinal() - 29)).isoformat()


async def test_a_message_just_before_midnight_utc_counts_on_its_utc_day(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    conv = await shop.conversation()
    await _clear_messages(shop)
    await add_message(shop, conv, at("2026-03-11", "23:30:00"))
    body = await overview(client, shop, **{"from": "2026-03-11", "to": "2026-03-12"})
    assert [(d["date"], d["inbound"]) for d in body["daily"]] == [
        ("2026-03-11", 1),
        ("2026-03-12", 0),
    ]


async def test_conversation_states_are_a_current_snapshot_and_skip_deleted(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    kept, waiting, resolved, deleted = [await shop.conversation() for _ in range(4)]
    async with shop.factory() as session:
        for conv_id, state in (
            (waiting, ConversationState.HUMAN_REQUIRED),
            (resolved, ConversationState.RESOLVED),
        ):
            await session.execute(
                update(Conversation).where(Conversation.id == conv_id).values(state=state)
            )
        await session.execute(
            update(Conversation)
            .where(Conversation.id == deleted)
            .values(deleted_at=datetime.now(UTC))
        )
        await session.commit()
    body = await overview(client, shop)  # a range in the past: the snapshot ignores it
    assert body["conversations"]["by_state"] == {
        "ai_active": 1,
        "human_required": 1,
        "human_active": 0,
        "resolved": 1,
    }
    assert body["conversations"]["new"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-03-15", "to": "2026-03-14"},
        {"from": "2025-01-01", "to": "2026-03-14"},  # more than 366 days
        {"from": "not-a-date"},
        {"to": "2026-13-01"},
    ],
)
async def test_invalid_ranges_are_422(
    client: httpx.AsyncClient, shop: Shop, params: dict[str, str]
) -> None:
    for url in (OVERVIEW, USAGE):
        response = await client.get(url, headers=shop.org.headers(), params=params)
        assert response.status_code == 422, (url, response.text)


async def test_a_range_of_exactly_366_days_is_allowed(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    ok = await client.get(
        OVERVIEW, headers=shop.org.headers(), params={"from": "2024-03-14", "to": "2025-03-14"}
    )
    assert ok.status_code == 200 and len(ok.json()["daily"]) == 366
    too_long = await client.get(
        OVERVIEW, headers=shop.org.headers(), params={"from": "2024-03-13", "to": "2025-03-14"}
    )
    assert too_long.status_code == 422


# ---- usage ----
async def test_usage_report_totals_breakdowns_and_daily_series(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    await add_usage(
        shop, at("2026-03-10"), purpose="moderation", tokens=(50, 10), cost="0.000100", latency=100
    )
    await add_usage(
        shop,
        at("2026-03-10", "15:00:00"),
        purpose="dm_reply",
        tokens=(400, 80),
        cost="0.002000",
        latency=300,
    )
    await add_usage(
        shop,
        at("2026-03-12"),
        purpose="dm_reply",
        provider="openai",
        model="m2",
        tokens=(300, 60),
        cost="0.004000",
        latency=500,
        status="error",
    )
    await add_usage(
        shop,
        at("2026-03-14", "23:59:59"),
        purpose="comment_reply",
        tokens=(10, 5),
        cost="0.000300",
        latency=100,
    )
    await add_usage(shop, at("2026-03-09", "23:59:59"), cost="9.000000")  # before the range
    await add_usage(shop, at("2026-03-15"), cost="9.000000")  # after the range

    response = await client.get(USAGE, headers=shop.org.headers(), params=RANGE)
    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["requests"] == 4
    assert (body["totals"]["input_tokens"], body["totals"]["output_tokens"]) == (760, 155)
    assert Decimal(body["totals"]["estimated_cost"]) == Decimal("0.006400")
    assert body["failed_requests"] == 1 and body["average_latency_ms"] == 250

    assert [
        (p["purpose"], Decimal(p["estimated_cost"]), p["requests"]) for p in body["by_purpose"]
    ] == [
        ("dm_reply", Decimal("0.006000"), 2),  # costliest first
        ("comment_reply", Decimal("0.000300"), 1),
        ("moderation", Decimal("0.000100"), 1),
    ]
    assert [
        (m["provider"], m["model"], Decimal(m["estimated_cost"])) for m in body["by_model"]
    ] == [
        ("openai", "m2", Decimal("0.004000")),
        ("groq", "m1", Decimal("0.002400")),
    ]
    assert [(d["date"], d["requests"], Decimal(d["estimated_cost"])) for d in body["daily"]] == [
        ("2026-03-10", 2, Decimal("0.002100")),
        ("2026-03-11", 0, Decimal("0")),
        ("2026-03-12", 1, Decimal("0.004000")),
        ("2026-03-13", 0, Decimal("0")),
        ("2026-03-14", 1, Decimal("0.000300")),
    ]


async def test_usage_flags_requests_that_had_no_price(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    await add_usage(shop, at("2026-03-10"), cost="0.002000")  # priced
    await add_usage(shop, at("2026-03-11"), model="unlisted", tokens=(80, 20), cost="0")  # no price
    await add_usage(shop, at("2026-03-12"), model="unlisted", tokens=(10, 5), cost="0")  # no price
    await add_usage(shop, at("2026-03-13"), tokens=(0, 0), cost="0", status="error")  # no tokens
    body = (await client.get(USAGE, headers=shop.org.headers(), params=RANGE)).json()
    assert body["unpriced_requests"] == 2  # a failed call that used nothing is not "unpriced"
    assert body["totals"]["requests"] == 4


async def test_usage_with_no_requests_is_zero_and_has_no_latency(
    client: httpx.AsyncClient, shop: Shop
) -> None:
    body = (await client.get(USAGE, headers=shop.org.headers(), params=RANGE)).json()
    assert (
        body["totals"]
        == {
            "requests": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "estimated_cost": "0",
        }
        or Decimal(body["totals"]["estimated_cost"]) == 0
    )
    assert body["average_latency_ms"] is None and body["failed_requests"] == 0
    assert body["unpriced_requests"] == 0
    assert body["by_purpose"] == [] and body["by_model"] == [] and len(body["daily"]) == 5


# ---- access and isolation ----
@pytest.mark.parametrize(
    ("role", "overview_ok", "usage_ok"),
    [
        (MemberRole.OWNER, True, True),
        (MemberRole.ADMIN, True, True),
        (MemberRole.MANAGER, True, False),  # may see analytics, not costs
        (MemberRole.STAFF, False, False),
    ],
)
async def test_role_access(
    client: httpx.AsyncClient, shop: Shop, role: MemberRole, overview_ok: bool, usage_ok: bool
) -> None:
    headers = shop.org.headers(role)
    assert (await client.get(OVERVIEW, headers=headers, params=RANGE)).status_code == (
        200 if overview_ok else 403
    )
    assert (await client.get(USAGE, headers=headers, params=RANGE)).status_code == (
        200 if usage_ok else 403
    )


async def test_other_organizations_data_never_leaks(
    client: httpx.AsyncClient,
    shop: Shop,
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    cipher: TokenCipher,
) -> None:
    other = await _shop(session_factory, redis, cipher)
    conv = await shop.conversation()
    await _clear_messages(shop)
    await add_message(shop, conv, at("2026-03-11"))
    await add_usage(shop, at("2026-03-11"), cost="1.000000")
    other_view = (await client.get(OVERVIEW, headers=other.org.headers(), params=RANGE)).json()
    assert other_view["messages"]["inbound"] == 0
    other_usage = (await client.get(USAGE, headers=other.org.headers(), params=RANGE)).json()
    assert other_usage["totals"]["requests"] == 0
    # and the owner of the seeded org still sees theirs
    own = (await client.get(OVERVIEW, headers=shop.org.headers(), params=RANGE)).json()
    assert own["messages"]["inbound"] == 1


async def test_unauthenticated_is_rejected(client: httpx.AsyncClient) -> None:
    assert (await client.get(OVERVIEW)).status_code == 401
    assert (await client.get(USAGE)).status_code == 401


async def test_reading_analytics_changes_nothing(
    client: httpx.AsyncClient, shop: Shop, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    conv = await shop.conversation()
    await client.get(OVERVIEW, headers=shop.org.headers(), params=RANGE)
    await client.get(USAGE, headers=shop.org.headers(), params=RANGE)
    async with session_factory() as session:
        states = (
            await session.execute(select(Conversation.state).where(Conversation.id == conv))
        ).scalar_one()
    assert states is ConversationState.AI_ACTIVE
