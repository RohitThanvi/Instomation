"""Knowledge base API against real PostgreSQL: CRUD, RBAC, tenant isolation, the per-organization
cap under concurrency, audit contents, pagination and full-text retrieval (incl. hostile input)."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.main import create_app
from app.models.business import KnowledgeEntry
from app.models.enums import AccountType, MemberRole
from app.models.identity import Organization, OrganizationMember, User
from app.models.ops import AuditLog
from tests.integration.test_conversations_flow import FakeVerifier

BASE = "/api/v1/knowledge"


@dataclass
class Org:
    id: uuid.UUID
    users: dict[MemberRole, str]

    def headers(self, role: MemberRole = MemberRole.OWNER) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.users[role]}", "X-Organization-ID": str(self.id)}


@pytest_asyncio.fixture
async def app(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> AsyncIterator[FastAPI]:
    application = create_app()
    application.state.session_factory = session_factory
    application.state.redis = redis
    application.state.token_verifier = FakeVerifier()
    yield application
    application.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        yield http


@pytest_asyncio.fixture
async def org(session_factory: async_sessionmaker[AsyncSession]) -> Org:
    return await _make_org(session_factory)


async def _make_org(factory: async_sessionmaker[AsyncSession]) -> Org:
    users: dict[MemberRole, str] = {}
    async with factory() as session:
        organization = Organization(name="Shop", account_type=AccountType.BUSINESS)
        session.add(organization)
        await session.flush()
        for role in MemberRole:
            clerk_id = f"user_{uuid.uuid4().hex[:12]}"
            user = User(clerk_user_id=clerk_id)
            session.add(user)
            await session.flush()
            session.add(
                OrganizationMember(organization_id=organization.id, user_id=user.id, role=role)
            )
            users[role] = clerk_id
        await session.commit()
        return Org(organization.id, users)


async def _create(
    client: httpx.AsyncClient,
    org: Org,
    title: str = "Shipping",
    content: str = "We ship worldwide.",
    kind: str = "faq",
    **extra: Any,
) -> dict[str, Any]:
    response = await client.post(
        f"{BASE}/entries",
        headers=org.headers(),
        json={"kind": kind, "title": title, "content": content, **extra},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def _search(
    client: httpx.AsyncClient, org: Org, query: str, limit: int = 5
) -> httpx.Response:
    return await client.post(
        f"{BASE}/search", headers=org.headers(), json={"query": query, "limit": limit}
    )


# ---- CRUD ----
async def test_create_get_update_list_delete_roundtrip(client: httpx.AsyncClient, org: Org) -> None:
    created = await _create(
        client, org, "Returns", "30 day returns.", "policy", attributes={"days": 30, "free": True}
    )
    assert created["kind"] == "policy" and created["attributes"] == {"days": 30, "free": True}
    entry_url = f"{BASE}/entries/{created['id']}"

    assert (await client.get(entry_url, headers=org.headers())).json()["title"] == "Returns"

    patched = await client.patch(
        entry_url, headers=org.headers(), json={"content": "14 day returns."}
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["content"] == "14 day returns." and body["title"] == "Returns"
    assert body["attributes"] == {"days": 30, "free": True}  # untouched
    assert body["updated_at"] >= created["updated_at"]

    listed = await client.get(f"{BASE}/entries", headers=org.headers())
    assert [e["id"] for e in listed.json()["items"]] == [created["id"]]

    assert (await client.delete(entry_url, headers=org.headers())).status_code == 204
    assert (await client.get(entry_url, headers=org.headers())).status_code == 404
    assert (await client.delete(entry_url, headers=org.headers())).status_code == 404
    assert (await client.get(f"{BASE}/entries", headers=org.headers())).json()["items"] == []


async def test_delete_is_soft(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    created = await _create(client, org)
    await client.delete(f"{BASE}/entries/{created['id']}", headers=org.headers())
    async with session_factory() as session:
        row = await session.get(KnowledgeEntry, uuid.UUID(created["id"]))
        assert row is not None and row.deleted_at is not None


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "faq", "title": "", "content": "x"},
        {"kind": "faq", "title": "t", "content": "x" * 4001},
        {"kind": "nope", "title": "t", "content": "x"},
        {"title": "t", "content": "x"},
        {"kind": "faq", "title": "t", "content": "x", "attributes": {"a": {"b": 1}}},
    ],
)
async def test_invalid_create_is_422_and_stores_nothing(
    client: httpx.AsyncClient, org: Org, payload: dict[str, Any]
) -> None:
    response = await client.post(f"{BASE}/entries", headers=org.headers(), json=payload)
    assert response.status_code == 422
    assert (await client.get(f"{BASE}/entries", headers=org.headers())).json()["items"] == []


async def test_empty_patch_is_422(client: httpx.AsyncClient, org: Org) -> None:
    created = await _create(client, org)
    response = await client.patch(f"{BASE}/entries/{created['id']}", headers=org.headers(), json={})
    assert response.status_code == 422


async def test_unknown_or_malformed_id_is_404_or_422(client: httpx.AsyncClient, org: Org) -> None:
    missing = await client.get(f"{BASE}/entries/{uuid.uuid4()}", headers=org.headers())
    assert missing.status_code == 404
    assert (
        await client.get(f"{BASE}/entries/not-a-uuid", headers=org.headers())
    ).status_code == 422


async def test_pagination_and_kind_filter(client: httpx.AsyncClient, org: Org) -> None:
    ids = [(await _create(client, org, f"Entry {i}", f"body {i}"))["id"] for i in range(3)]
    await _create(client, org, "Cut", "Haircut", "service")

    first = (await client.get(f"{BASE}/entries?limit=2", headers=org.headers())).json()
    assert len(first["items"]) == 2 and first["next_cursor"]
    second = (
        await client.get(
            f"{BASE}/entries?limit=2&cursor={first['next_cursor']}", headers=org.headers()
        )
    ).json()
    seen = [e["id"] for e in first["items"] + second["items"]]
    assert len(seen) == len(set(seen)) == 4 and second["next_cursor"] is None
    assert set(ids) <= set(seen)

    services = (await client.get(f"{BASE}/entries?kind=service", headers=org.headers())).json()
    assert [e["title"] for e in services["items"]] == ["Cut"]
    assert (await client.get(f"{BASE}/entries?limit=0", headers=org.headers())).status_code == 422


# ---- RBAC ----
@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        (MemberRole.OWNER, True),
        (MemberRole.ADMIN, True),
        (MemberRole.MANAGER, False),
        (MemberRole.STAFF, False),
    ],
)
async def test_only_owner_and_admin_manage_knowledge(
    client: httpx.AsyncClient, org: Org, role: MemberRole, allowed: bool
) -> None:
    existing = await _create(client, org)
    headers = org.headers(role)
    entry_url = f"{BASE}/entries/{existing['id']}"
    body = {"kind": "faq", "title": "t", "content": "c"}
    responses = [
        await client.get(f"{BASE}/entries", headers=headers),
        await client.post(f"{BASE}/entries", headers=headers, json=body),
        await client.get(entry_url, headers=headers),
        await client.patch(entry_url, headers=headers, json={"title": "z"}),
        await client.post(f"{BASE}/search", headers=headers, json={"query": "ship"}),
        await client.delete(entry_url, headers=headers),
    ]
    codes = {r.status_code for r in responses}
    if allowed:
        assert codes <= {200, 201, 204}
    else:
        assert codes == {403}
        still_there = await client.get(entry_url, headers=org.headers())
        assert still_there.status_code == 200 and still_there.json()["title"] == "Shipping"


async def test_unauthenticated_is_rejected(client: httpx.AsyncClient) -> None:
    assert (await client.get(f"{BASE}/entries")).status_code == 401


# ---- tenant isolation ----
async def test_other_organizations_cannot_see_or_touch_entries(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    other = await _make_org(session_factory)
    mine = await _create(client, org, "Secret pricing", "Wholesale price is 4 dollars")
    url = f"{BASE}/entries/{mine['id']}"

    assert (await client.get(url, headers=other.headers())).status_code == 404
    assert (
        await client.patch(url, headers=other.headers(), json={"title": "hacked"})
    ).status_code == 404
    assert (await client.delete(url, headers=other.headers())).status_code == 404
    assert (await client.get(f"{BASE}/entries", headers=other.headers())).json()["items"] == []
    assert (await _search(client, other, "wholesale price pricing")).json() == []

    intact = (await client.get(url, headers=org.headers())).json()
    assert intact["title"] == "Secret pricing"
    assert len((await _search(client, org, "wholesale price")).json()) == 1


async def test_a_user_cannot_act_in_an_organization_they_do_not_belong_to(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    other = await _make_org(session_factory)
    stranger = {
        "Authorization": f"Bearer {other.users[MemberRole.OWNER]}",
        "X-Organization-ID": str(org.id),
    }
    response = await client.post(
        f"{BASE}/entries", headers=stranger, json={"kind": "faq", "title": "t", "content": "c"}
    )
    assert response.status_code in {403, 404}
    async with session_factory() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(KnowledgeEntry)
            .where(KnowledgeEntry.organization_id == org.id)
        )
        assert count == 0


# ---- entry cap ----
async def test_cap_blocks_creation_and_deleting_frees_a_slot(
    app: FastAPI, client: httpx.AsyncClient, org: Org
) -> None:
    app.dependency_overrides[get_settings] = lambda: get_settings().model_copy(
        update={"knowledge_max_entries": 2}
    )
    first = await _create(client, org, "One", "one")
    await _create(client, org, "Two", "two")
    blocked = await client.post(
        f"{BASE}/entries", headers=org.headers(), json={"kind": "faq", "title": "3", "content": "3"}
    )
    assert (
        blocked.status_code == 409 and blocked.json()["error"]["code"] == "KNOWLEDGE_LIMIT_REACHED"
    )

    await client.delete(f"{BASE}/entries/{first['id']}", headers=org.headers())
    await _create(client, org, "Three", "three")


async def test_cap_holds_under_concurrent_creates(
    app: FastAPI,
    client: httpx.AsyncClient,
    org: Org,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    cap = 3
    app.dependency_overrides[get_settings] = lambda: get_settings().model_copy(
        update={"knowledge_max_entries": cap}
    )
    responses = await asyncio.gather(
        *(
            client.post(
                f"{BASE}/entries",
                headers=org.headers(),
                json={"kind": "faq", "title": f"t{i}", "content": f"c{i}"},
            )
            for i in range(12)
        )
    )
    assert sorted(r.status_code for r in responses) == [201] * cap + [409] * (12 - cap)
    async with session_factory() as session:
        stored = await session.scalar(
            select(func.count())
            .select_from(KnowledgeEntry)
            .where(KnowledgeEntry.organization_id == org.id, KnowledgeEntry.deleted_at.is_(None))
        )
        assert stored == cap


# ---- audit ----
async def test_changes_are_audited_without_content(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    created = await _create(client, org, "Private title", "Private content")
    await client.patch(
        f"{BASE}/entries/{created['id']}", headers=org.headers(), json={"title": "N"}
    )
    await client.delete(f"{BASE}/entries/{created['id']}", headers=org.headers())
    async with session_factory() as session:
        rows = (
            (
                await session.execute(
                    select(AuditLog)
                    .where(AuditLog.organization_id == org.id, AuditLog.action.like("knowledge.%"))
                    .order_by(AuditLog.created_at, AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
    assert {r.action for r in rows} == {
        "knowledge.entry.created",
        "knowledge.entry.updated",
        "knowledge.entry.deleted",
    }
    for row in rows:
        assert row.metadata_json == {"entry_id": created["id"], "kind": "faq"}
        assert row.user_id is not None


# ---- search ----
async def test_search_ranks_the_relevant_entry_first(client: httpx.AsyncClient, org: Org) -> None:
    await _create(client, org, "Opening hours", "We are open Monday to Saturday, 9am to 6pm.")
    await _create(
        client, org, "Shipping and delivery", "Delivery takes five days. We deliver worldwide."
    )
    await _create(client, org, "Returns", "Unused items can be returned within 30 days.")

    hits = (
        await _search(client, org, "Do you deliver abroad? How many days does delivery take?")
    ).json()
    assert hits[0]["entry"]["title"] == "Shipping and delivery"
    assert hits[0]["score"] > 0
    assert [h["score"] for h in hits] == sorted((h["score"] for h in hits), reverse=True)


async def test_search_respects_limit_and_finds_nothing_for_unrelated_text(
    client: httpx.AsyncClient, org: Org
) -> None:
    for i in range(4):
        await _create(client, org, f"Delivery option {i}", "delivery details")
    assert len((await _search(client, org, "delivery", limit=2)).json()) == 2
    assert (await _search(client, org, "quantum chromodynamics")).json() == []
    assert (await _search(client, org, "a is to")).json() == []  # nothing usable after filtering


async def test_search_sees_updates_and_forgets_deletions(
    client: httpx.AsyncClient, org: Org
) -> None:
    created = await _create(client, org, "Menu", "We sell coffee")
    assert len((await _search(client, org, "coffee")).json()) == 1
    assert (await _search(client, org, "espresso")).json() == []

    await client.patch(
        f"{BASE}/entries/{created['id']}",
        headers=org.headers(),
        json={"content": "We sell espresso"},
    )
    assert len((await _search(client, org, "espresso")).json()) == 1
    assert (await _search(client, org, "coffee")).json() == []

    await client.delete(f"{BASE}/entries/{created['id']}", headers=org.headers())
    assert (await _search(client, org, "espresso")).json() == []


@pytest.mark.parametrize(
    "hostile",
    [
        "'); DROP TABLE knowledge_entries; --",
        "a & | ! ( ) : * <-> \\ ' \"",
        "(((",
        "ship:* & !(deliver)",
        "x" * 500,
        "ship " * 90,
    ],
)
async def test_hostile_search_text_cannot_break_the_query(
    client: httpx.AsyncClient, org: Org, hostile: str
) -> None:
    await _create(client, org, "Shipping", "We ship worldwide")
    response = await _search(client, org, hostile)
    assert response.status_code == 200
    assert len((await client.get(f"{BASE}/entries", headers=org.headers())).json()["items"]) == 1


async def test_search_input_bounds(client: httpx.AsyncClient, org: Org) -> None:
    assert (await _search(client, org, "x" * 501)).status_code == 422
    assert (await _search(client, org, "   ")).status_code == 422
    assert (await _search(client, org, "ship", limit=0)).status_code == 422
    assert (await _search(client, org, "ship", limit=21)).status_code == 422


async def test_search_matches_non_latin_text(client: httpx.AsyncClient, org: Org) -> None:
    await _create(client, org, "डिलीवरी", "हम पूरे भारत में डिलीवरी करते हैं")
    hits = (await _search(client, org, "क्या आप जयपुर में डिलीवरी करते हैं")).json()
    assert [h["entry"]["title"] for h in hits] == ["डिलीवरी"]
