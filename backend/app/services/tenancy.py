import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.rbac import Permission, has_permission
from app.models.enums import MemberRole
from app.models.identity import Organization, OrganizationMember, User


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Server-verified tenant. Built only from a verified identity plus a membership row."""

    user_id: uuid.UUID
    organization_id: uuid.UUID
    role: MemberRole


async def get_or_create_user(session: AsyncSession, clerk_user_id: str) -> User:
    """Just-in-time provisioning; the upsert is race-safe under concurrent first requests."""
    await session.execute(
        insert(User)
        .values(clerk_user_id=clerk_user_id)
        .on_conflict_do_nothing(index_elements=[User.clerk_user_id])
    )
    user = (
        await session.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    ).scalar_one()
    if user.deleted_at is not None:
        raise AppError("ACCOUNT_DISABLED", "This account is no longer active.", 403)
    return user


async def require_permission(
    session: AsyncSession, user_id: uuid.UUID, organization_id: uuid.UUID, permission: Permission
) -> None:
    """Re-check authorization outside a bearer-authenticated request (e.g. OAuth callbacks)."""
    role = (
        await session.execute(
            select(OrganizationMember.role)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
                Organization.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if role is None or not has_permission(role, permission):
        raise AppError("PERMISSION_DENIED", "You do not have permission to do this.", 403)


async def resolve_tenant(
    session: AsyncSession, user: User, requested_organization_id: uuid.UUID | None
) -> TenantContext:
    """The client may *select* an organization, but only one it is a member of."""
    stmt = (
        select(OrganizationMember.organization_id, OrganizationMember.role)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(OrganizationMember.user_id == user.id, Organization.deleted_at.is_(None))
    )
    if requested_organization_id is not None:
        stmt = stmt.where(OrganizationMember.organization_id == requested_organization_id)
    memberships = (await session.execute(stmt.limit(2))).all()

    if requested_organization_id is not None:
        if not memberships:
            raise AppError(
                "ORGANIZATION_ACCESS_DENIED", "You do not have access to this organization.", 403
            )
    elif len(memberships) != 1:
        raise AppError(
            "ORGANIZATION_REQUIRED",
            "Create or select an organization to continue.",
            400,
        )
    organization_id, role = memberships[0]
    return TenantContext(user_id=user.id, organization_id=organization_id, role=role)
