import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep, Tenant, require
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page, keyset_page
from app.core.rbac import Permission
from app.models.enums import MemberRole
from app.models.identity import Organization, OrganizationMember, User
from app.schemas.organization import (
    MemberOut,
    MemberRoleUpdate,
    OrganizationCreate,
    OrganizationOut,
)
from app.services import organizations as service
from app.services.tenancy import TenantContext

router = APIRouter(prefix="/organizations", tags=["organizations"])

Cursor = Annotated[str | None, Query(max_length=200)]
Limit = Annotated[int, Query(ge=1, le=MAX_LIMIT)]
MembersAdmin = Annotated[TenantContext, Depends(require(Permission.MEMBERS_MANAGE))]


@router.post("", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
async def create_organization(
    body: OrganizationCreate, user: CurrentUser, session: SessionDep
) -> OrganizationOut:
    organization = await service.create_organization(session, user, body.name, body.account_type)
    return OrganizationOut(
        id=organization.id,
        name=organization.name,
        account_type=organization.account_type,
        role=MemberRole.OWNER,
    )


@router.get("", response_model=Page[OrganizationOut])
async def list_my_organizations(
    user: CurrentUser, session: SessionDep, cursor: Cursor = None, limit: Limit = DEFAULT_LIMIT
) -> Page[OrganizationOut]:
    stmt = (
        select(
            Organization.id,
            Organization.name,
            Organization.account_type,
            OrganizationMember.role,
            OrganizationMember.created_at,
        )
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user.id, Organization.deleted_at.is_(None))
    )
    rows, next_cursor = await keyset_page(
        session,
        stmt,
        OrganizationMember.created_at,
        Organization.id,
        lambda row: (row.created_at, row.id),
        cursor,
        limit,
    )
    items = [
        OrganizationOut(id=r.id, name=r.name, account_type=r.account_type, role=r.role)
        for r in rows
    ]
    return Page[OrganizationOut](items=items, next_cursor=next_cursor)


@router.get("/current/members", response_model=Page[MemberOut])
async def list_members(
    tenant: Tenant, session: SessionDep, cursor: Cursor = None, limit: Limit = DEFAULT_LIMIT
) -> Page[MemberOut]:
    stmt = (
        select(
            OrganizationMember.id.label("membership_id"),
            OrganizationMember.user_id,
            OrganizationMember.role,
            OrganizationMember.created_at,
            User.email,
            User.full_name,
        )
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == tenant.organization_id)
    )
    rows, next_cursor = await keyset_page(
        session,
        stmt,
        OrganizationMember.created_at,
        OrganizationMember.id,
        lambda row: (row.created_at, row.membership_id),
        cursor,
        limit,
    )
    return Page[MemberOut](
        items=[MemberOut.model_validate(r, from_attributes=True) for r in rows],
        next_cursor=next_cursor,
    )


@router.patch("/current/members/{membership_id}", response_model=MemberOut)
async def update_member_role(
    membership_id: uuid.UUID, body: MemberRoleUpdate, tenant: MembersAdmin, session: SessionDep
) -> MemberOut:
    member = await service.change_member_role(session, tenant, membership_id, body.role)
    user = await session.get(User, member.user_id)
    assert user is not None  # noqa: S101 - FK guarantees the user exists
    return MemberOut(
        membership_id=member.id,
        user_id=member.user_id,
        email=user.email,
        full_name=user.full_name,
        role=member.role,
    )


@router.delete(
    "/current/members/{membership_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def remove_member(
    membership_id: uuid.UUID, tenant: MembersAdmin, session: SessionDep
) -> None:
    await service.remove_member(session, tenant, membership_id)
