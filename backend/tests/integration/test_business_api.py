"""Business profile + AI settings API on real PostgreSQL: RBAC, tenant isolation, validation,
upsert semantics, audit contents, and the end-to-end effect of switching DM automation on."""

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from arq.connections import ArqRedis
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.main import create_app
from app.models.business import AiSettings, BusinessProfile
from app.models.enums import MemberRole
from app.models.ops import AuditLog, Job
from app.services.instagram.crypto import TokenCipher
from tests.integration.test_conversations_flow import (
    FakeVerifier,
    _deliver_inbound_message,
    _org_and_account,
)
from tests.integration.test_knowledge_api import Org, _make_org

PROFILE = "/api/v1/business/profile"
AI = "/api/v1/settings/ai"


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
async def org(session_factory: async_sessionmaker[AsyncSession]) -> Org:
    return await _make_org(session_factory)


FULL: dict[str, Any] = {
    "brand_name": "Cafe Aroma",
    "description": "Specialty coffee",
    "industry": "Food",
    "location": "Jaipur",
    "website": "https://cafe-aroma.test",
    "contact_info": {"phone": "+91 99999 00000"},
    "policies": {"returns": "No returns on beans"},
    "communication_style": "friendly",
    "custom_instructions": "Mention our loyalty card.",
}


# ---- business profile ----
async def test_profile_defaults_then_replace_roundtrip(client: httpx.AsyncClient, org: Org) -> None:
    empty = (await client.get(PROFILE, headers=org.headers())).json()
    assert empty["brand_name"] is None and empty["communication_style"] == "professional"
    assert empty["contact_info"] == {} and empty["policies"] == {}

    saved = await client.put(PROFILE, headers=org.headers(), json=FULL)
    assert saved.status_code == 200 and saved.json() == FULL
    assert (await client.get(PROFILE, headers=org.headers())).json() == FULL


async def test_put_replaces_everything_a_missing_field_is_cleared(
    client: httpx.AsyncClient, org: Org
) -> None:
    await client.put(PROFILE, headers=org.headers(), json=FULL)
    after = (await client.put(PROFILE, headers=org.headers(), json={"brand_name": "New"})).json()
    assert after["brand_name"] == "New"
    assert after["description"] is None and after["website"] is None
    assert after["contact_info"] == {} and after["custom_instructions"] is None


async def test_text_is_trimmed_and_blank_means_cleared(client: httpx.AsyncClient, org: Org) -> None:
    body = {"brand_name": "  Cafe  ", "description": "   ", "contact_info": {" phone ": " 123 "}}
    saved = (await client.put(PROFILE, headers=org.headers(), json=body)).json()
    assert saved["brand_name"] == "Cafe" and saved["description"] is None
    assert saved["contact_info"] == {"phone": "123"}


@pytest.mark.parametrize(
    "payload",
    [
        {"website": "javascript:alert(1)"},
        {"website": "ftp://files.test"},
        {"website": "not a url"},
        {"brand_name": "x" * 201},
        {"description": "x" * 2001},
        {"custom_instructions": "x" * 2001},
        {"communication_style": "rude"},
        {"contact_info": {f"k{i}": "v" for i in range(11)}},
        {"contact_info": {"phone": "x" * 201}},
        {"contact_info": {"": "v"}},
        {"contact_info": {"phone": ""}},
        {"policies": {f"p{i}": "v" for i in range(11)}},
        {"policies": {"returns": "x" * 501}},
        {"policies": {"k" * 51: "v"}},
        {"policies": {"nested": {"a": "b"}}},
        {"unknown_field": "x"},
        {"brand_name": "Cafe", "unknown_field": "x"},
        {"timezone": "Asia/Kolkata"},  # not honored yet, so not accepted
    ],
)
async def test_invalid_profile_is_422_and_changes_nothing(
    client: httpx.AsyncClient, org: Org, payload: dict[str, Any]
) -> None:
    await client.put(PROFILE, headers=org.headers(), json={"brand_name": "Keep"})
    assert (await client.put(PROFILE, headers=org.headers(), json=payload)).status_code == 422
    assert (await client.get(PROFILE, headers=org.headers())).json()["brand_name"] == "Keep"


async def test_profile_limits_are_inclusive(client: httpx.AsyncClient, org: Org) -> None:
    body = {
        "brand_name": "b" * 200,
        "description": "d" * 2000,
        "contact_info": {f"k{i}": "v" * 200 for i in range(10)},
        "policies": {f"p{i}": "v" * 500 for i in range(10)},
    }
    assert (await client.put(PROFILE, headers=org.headers(), json=body)).status_code == 200


async def test_profile_audit_records_field_names_only(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await client.put(PROFILE, headers=org.headers(), json={"brand_name": "Secret Brand"})
    await client.put(PROFILE, headers=org.headers(), json={"brand_name": "Secret Brand"})  # no-op
    async with session_factory() as session:
        rows = (
            (
                await session.execute(
                    select(AuditLog).where(
                        AuditLog.organization_id == org.id,
                        AuditLog.action == "business.profile.updated",
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1  # the unchanged second save is not logged
    assert rows[0].metadata_json == {"fields": ["brand_name"]}


# ---- AI settings ----
async def test_reading_the_profile_does_not_create_a_row(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await client.get(PROFILE, headers=org.headers())
    async with session_factory() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(BusinessProfile)
            .where(BusinessProfile.organization_id == org.id)
        )
    assert count == 0


async def test_ai_settings_defaults_without_creating_a_row(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    body = (await client.get(AI, headers=org.headers())).json()
    assert body == {
        "dm_automation_enabled": False,
        "comment_automation_enabled": False,
        "confidence_threshold": 0.7,
        "max_response_tokens": 300,
        "temperature": 0.4,
        "max_replies_per_conversation_per_hour": 10,
    }
    async with session_factory() as session:
        count = await session.scalar(
            select(func.count()).select_from(AiSettings).where(AiSettings.organization_id == org.id)
        )
    assert count == 0  # reading does not write


async def test_ai_settings_patch_is_partial(client: httpx.AsyncClient, org: Org) -> None:
    first = await client.patch(AI, headers=org.headers(), json={"dm_automation_enabled": True})
    assert first.status_code == 200 and first.json()["dm_automation_enabled"] is True
    second = await client.patch(AI, headers=org.headers(), json={"confidence_threshold": 0.9})
    body = second.json()
    assert body["confidence_threshold"] == 0.9 and body["dm_automation_enabled"] is True
    assert body["temperature"] == 0.4
    assert (await client.get(AI, headers=org.headers())).json() == body


async def test_false_and_zero_are_real_values_not_missing(
    client: httpx.AsyncClient, org: Org
) -> None:
    await client.patch(
        AI, headers=org.headers(), json={"dm_automation_enabled": True, "temperature": 0.9}
    )
    body = (
        await client.patch(
            AI, headers=org.headers(), json={"dm_automation_enabled": False, "temperature": 0.0}
        )
    ).json()
    assert body["dm_automation_enabled"] is False and body["temperature"] == 0.0


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"dm_automation_enabled": None},
        {"confidence_threshold": 1.1},
        {"confidence_threshold": -0.1},
        {"max_response_tokens": 49},
        {"max_response_tokens": 1001},
        {"temperature": 1.5},
        {"max_replies_per_conversation_per_hour": 0},
        {"max_replies_per_conversation_per_hour": 101},
        {"provider": "openai"},  # not honored yet, so not accepted
        {"temperature": 0.5, "provider": "openai"},  # a valid field must not smuggle one in
        {"dm_automation_enabled": True, "model": "gpt-4o"},
        {"comment_like_enabled": True},
        {"dm_automation_enabled": "maybe"},
    ],
)
async def test_invalid_ai_settings_are_422(
    client: httpx.AsyncClient, org: Org, payload: dict[str, Any]
) -> None:
    assert (await client.patch(AI, headers=org.headers(), json=payload)).status_code == 422


async def test_ai_settings_audit_records_the_changes(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await client.patch(AI, headers=org.headers(), json={"dm_automation_enabled": True})
    await client.patch(AI, headers=org.headers(), json={"dm_automation_enabled": True})  # no-op
    async with session_factory() as session:
        rows = (
            (
                await session.execute(
                    select(AuditLog).where(
                        AuditLog.organization_id == org.id, AuditLog.action == "ai.settings.updated"
                    )
                )
            )
            .scalars()
            .all()
        )
    assert [r.metadata_json for r in rows] == [{"dm_automation_enabled": True}]


async def test_concurrent_first_saves_create_exactly_one_row(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    import asyncio

    responses = await asyncio.gather(
        *(
            client.patch(AI, headers=org.headers(), json={"max_response_tokens": 100 + i})
            for i in range(8)
        ),
        *(
            client.put(PROFILE, headers=org.headers(), json={"brand_name": f"B{i}"})
            for i in range(8)
        ),
    )
    assert {r.status_code for r in responses} == {200}
    async with session_factory() as session:
        ai_rows = await session.scalar(
            select(func.count()).select_from(AiSettings).where(AiSettings.organization_id == org.id)
        )
        profile_rows = await session.scalar(
            select(func.count())
            .select_from(BusinessProfile)
            .where(BusinessProfile.organization_id == org.id)
        )
    assert (ai_rows, profile_rows) == (1, 1)


# ---- RBAC and tenancy ----
@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        (MemberRole.OWNER, True),
        (MemberRole.ADMIN, True),
        (MemberRole.MANAGER, False),
        (MemberRole.STAFF, False),
    ],
)
async def test_only_owner_and_admin_manage_settings(
    client: httpx.AsyncClient, org: Org, role: MemberRole, allowed: bool
) -> None:
    headers = org.headers(role)
    responses = [
        await client.get(PROFILE, headers=headers),
        await client.put(PROFILE, headers=headers, json={"brand_name": "X"}),
        await client.get(AI, headers=headers),
        await client.patch(AI, headers=headers, json={"dm_automation_enabled": True}),
    ]
    assert {r.status_code for r in responses} == ({200} if allowed else {403})
    if not allowed:
        owner_view = (await client.get(AI, headers=org.headers())).json()
        assert owner_view["dm_automation_enabled"] is False


async def test_settings_are_per_organization(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    other = await _make_org(session_factory)
    await client.put(PROFILE, headers=org.headers(), json={"brand_name": "Mine"})
    await client.patch(AI, headers=org.headers(), json={"dm_automation_enabled": True})
    assert (await client.get(PROFILE, headers=other.headers())).json()["brand_name"] is None
    assert (await client.get(AI, headers=other.headers())).json()["dm_automation_enabled"] is False
    stranger = {
        "Authorization": f"Bearer {other.users[MemberRole.OWNER]}",
        "X-Organization-ID": str(org.id),
    }
    assert (await client.get(PROFILE, headers=stranger)).status_code in {403, 404}
    assert (await client.patch(AI, headers=stranger, json={"temperature": 0.9})).status_code in {
        403,
        404,
    }
    assert (await client.get(AI, headers=org.headers())).json()["temperature"] == 0.4


async def test_unauthenticated_is_rejected(client: httpx.AsyncClient) -> None:
    assert (await client.get(PROFILE)).status_code == 401
    assert (await client.patch(AI, json={"temperature": 0.1})).status_code == 401


# ---- the point of it all: the setting really switches the pipeline ----
async def test_enabling_dm_automation_through_the_api_starts_moderation_of_new_dms(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    pool: ArqRedis,
    cipher: TokenCipher,
) -> None:
    clerk_org = await _make_org(session_factory)
    _, _, account_id, account_external_id = await _org_and_account(session_factory, cipher)
    # `_org_and_account` builds its own organization, so attach the account to the API-managed one
    async with session_factory() as session:
        from app.models.instagram import InstagramAccount

        account = await session.get(InstagramAccount, account_id)
        assert account is not None
        account.organization_id = clerk_org.id
        await session.commit()

    async def deliver(mid: str) -> None:
        await _deliver_inbound_message(
            session_factory,
            pool,
            clerk_org.id,
            account_id,
            account_external_id,
            f"cust-{uuid.uuid4().hex[:6]}",
            mid,
            "hello there",
        )

    async def moderation_jobs() -> int:
        async with session_factory() as session:
            return int(
                await session.scalar(
                    select(func.count())
                    .select_from(Job)
                    .where(Job.organization_id == clerk_org.id, Job.kind == "moderate_message")
                )
                or 0
            )

    await deliver(f"mid-{uuid.uuid4().hex[:8]}")
    assert await moderation_jobs() == 0  # automation is off by default

    await client.patch(AI, headers=clerk_org.headers(), json={"dm_automation_enabled": True})
    await deliver(f"mid-{uuid.uuid4().hex[:8]}")
    assert await moderation_jobs() == 1

    await client.patch(AI, headers=clerk_org.headers(), json={"dm_automation_enabled": False})
    await deliver(f"mid-{uuid.uuid4().hex[:8]}")
    assert await moderation_jobs() == 1
