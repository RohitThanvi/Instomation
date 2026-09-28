import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.security import Identity
from app.main import create_app
from app.models.enums import MemberRole
from app.models.identity import OrganizationMember, User
from app.models.ops import AuditLog


class FakeVerifier:
    """Test double: the bearer token *is* the Clerk user id."""

    async def verify(self, token: str) -> Identity:
        return Identity(clerk_user_id=token, session_id=None)


@pytest_asyncio.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()
    app.state.session_factory = session_factory
    app.state.token_verifier = FakeVerifier()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


def _auth(user: str, organization_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {user}"}
    if organization_id:
        headers["X-Organization-ID"] = organization_id
    return headers


def _new_user() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


async def _create_org(client: httpx.AsyncClient, user: str, name: str = "Acme") -> dict[str, Any]:
    response = await client.post(
        "/api/v1/organizations",
        json={"name": name, "account_type": "business"},
        headers=_auth(user),
    )
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


async def _add_member(
    factory: async_sessionmaker[AsyncSession], org_id: str, clerk_id: str, role: MemberRole
) -> uuid.UUID:
    async with factory() as session:
        user = User(clerk_user_id=clerk_id)
        session.add(user)
        await session.flush()
        member = OrganizationMember(organization_id=uuid.UUID(org_id), user_id=user.id, role=role)
        session.add(member)
        await session.commit()
        return member.id


async def test_create_organization_makes_caller_owner_and_audits(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner = _new_user()
    org = await _create_org(client, owner)
    assert org["role"] == "owner"
    async with session_factory() as session:
        actions = (
            (
                await session.execute(
                    select(AuditLog.action).where(AuditLog.organization_id == uuid.UUID(org["id"]))
                )
            )
            .scalars()
            .all()
        )
    assert actions == ["organization.created"]


async def test_tenant_is_never_taken_from_client_input(client: httpx.AsyncClient) -> None:
    alice, mallory = _new_user(), _new_user()
    alice_org = await _create_org(client, alice, "Alice Co")
    await _create_org(client, mallory, "Mallory Co")

    forged = await client.get(
        "/api/v1/organizations/current/members", headers=_auth(mallory, alice_org["id"])
    )
    assert forged.status_code == 403
    assert forged.json()["error"]["code"] == "ORGANIZATION_ACCESS_DENIED"

    own = await client.get("/api/v1/organizations/current/members", headers=_auth(mallory))
    assert own.status_code == 200
    assert len(own.json()["items"]) == 1


async def test_multi_org_user_must_select_and_can_switch(client: httpx.AsyncClient) -> None:
    user = _new_user()
    first = await _create_org(client, user, "First")
    second = await _create_org(client, user, "Second")

    ambiguous = await client.get("/api/v1/organizations/current/members", headers=_auth(user))
    assert ambiguous.status_code == 400
    assert ambiguous.json()["error"]["code"] == "ORGANIZATION_REQUIRED"

    for org in (first, second):
        ok = await client.get(
            "/api/v1/organizations/current/members", headers=_auth(user, org["id"])
        )
        assert ok.status_code == 200


async def test_user_without_organization_is_told_to_create_one(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/organizations/current/members", headers=_auth(_new_user()))
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "ORGANIZATION_REQUIRED"


async def test_organization_list_is_paginated(client: httpx.AsyncClient) -> None:
    user = _new_user()
    for index in range(3):
        await _create_org(client, user, f"Org {index}")
    first = (await client.get("/api/v1/organizations?limit=2", headers=_auth(user))).json()
    assert len(first["items"]) == 2 and first["next_cursor"]
    second = (
        await client.get(
            f"/api/v1/organizations?limit=2&cursor={first['next_cursor']}", headers=_auth(user)
        )
    ).json()
    assert len(second["items"]) == 1 and second["next_cursor"] is None
    seen = {o["id"] for o in first["items"]} | {o["id"] for o in second["items"]}
    assert len(seen) == 3


async def test_staff_cannot_manage_members(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner, staff = _new_user(), _new_user()
    org = await _create_org(client, owner)
    staff_membership = await _add_member(session_factory, org["id"], staff, MemberRole.STAFF)
    response = await client.patch(
        f"/api/v1/organizations/current/members/{staff_membership}",
        json={"role": "manager"},
        headers=_auth(staff),
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PERMISSION_DENIED"


async def test_admin_cannot_grant_ownership_but_owner_can(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner, admin, staff = _new_user(), _new_user(), _new_user()
    org = await _create_org(client, owner)
    await _add_member(session_factory, org["id"], admin, MemberRole.ADMIN)
    staff_membership = await _add_member(session_factory, org["id"], staff, MemberRole.STAFF)
    url = f"/api/v1/organizations/current/members/{staff_membership}"

    denied = await client.patch(url, json={"role": "owner"}, headers=_auth(admin))
    assert denied.status_code == 403
    allowed = await client.patch(url, json={"role": "owner"}, headers=_auth(owner))
    assert allowed.status_code == 200 and allowed.json()["role"] == "owner"


async def test_last_owner_cannot_be_demoted_or_removed(client: httpx.AsyncClient) -> None:
    owner = _new_user()
    org = await _create_org(client, owner)
    members = (
        await client.get("/api/v1/organizations/current/members", headers=_auth(owner))
    ).json()["items"]
    url = f"/api/v1/organizations/current/members/{members[0]['membership_id']}"

    demote = await client.patch(url, json={"role": "admin"}, headers=_auth(owner))
    remove = await client.delete(url, headers=_auth(owner))
    assert demote.status_code == remove.status_code == 409
    assert demote.json()["error"]["code"] == "LAST_OWNER"
    assert org["role"] == "owner"


async def test_member_from_another_tenant_is_not_addressable(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    owner_a, owner_b, victim = _new_user(), _new_user(), _new_user()
    org_a = await _create_org(client, owner_a, "A")
    await _create_org(client, owner_b, "B")
    victim_membership = await _add_member(session_factory, org_a["id"], victim, MemberRole.STAFF)
    response = await client.delete(
        f"/api/v1/organizations/current/members/{victim_membership}", headers=_auth(owner_b)
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MEMBER_NOT_FOUND"
