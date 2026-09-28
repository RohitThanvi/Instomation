import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.rbac import can_change_role
from app.models.enums import AccountType, MemberRole
from app.models.identity import Organization, OrganizationMember, User
from app.services.audit import record_audit
from app.services.tenancy import TenantContext


async def create_organization(
    session: AsyncSession, user: User, name: str, account_type: AccountType
) -> Organization:
    organization = Organization(name=name.strip(), account_type=account_type)
    session.add(organization)
    await session.flush()
    session.add(
        OrganizationMember(organization_id=organization.id, user_id=user.id, role=MemberRole.OWNER)
    )
    record_audit(session, "organization.created", organization.id, user.id)
    return organization


async def _get_member(
    session: AsyncSession, tenant: TenantContext, membership_id: uuid.UUID
) -> OrganizationMember:
    member = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.id == membership_id,
                OrganizationMember.organization_id == tenant.organization_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise AppError("MEMBER_NOT_FOUND", "Member not found.", 404)
    return member


async def _ensure_not_last_owner(session: AsyncSession, member: OrganizationMember) -> None:
    if member.role is not MemberRole.OWNER:
        return
    owners = (
        await session.execute(
            select(func.count()).where(
                OrganizationMember.organization_id == member.organization_id,
                OrganizationMember.role == MemberRole.OWNER,
            )
        )
    ).scalar_one()
    if owners <= 1:
        raise AppError("LAST_OWNER", "An organization must keep at least one owner.", 409)


async def change_member_role(
    session: AsyncSession, tenant: TenantContext, membership_id: uuid.UUID, new_role: MemberRole
) -> OrganizationMember:
    member = await _get_member(session, tenant, membership_id)
    if member.role is new_role:
        return member
    if not can_change_role(tenant.role, member.role, new_role):
        raise AppError("PERMISSION_DENIED", "You do not have permission to do this.", 403)
    await _ensure_not_last_owner(session, member)
    previous = member.role
    member.role = new_role
    record_audit(
        session,
        "member.role_changed",
        tenant.organization_id,
        tenant.user_id,
        {"membership_id": str(member.id), "from": previous.value, "to": new_role.value},
    )
    return member


async def remove_member(
    session: AsyncSession, tenant: TenantContext, membership_id: uuid.UUID
) -> None:
    member = await _get_member(session, tenant, membership_id)
    if not can_change_role(tenant.role, member.role, MemberRole.STAFF):
        raise AppError("PERMISSION_DENIED", "You do not have permission to do this.", 403)
    await _ensure_not_last_owner(session, member)
    await session.delete(member)
    record_audit(
        session,
        "member.removed",
        tenant.organization_id,
        tenant.user_id,
        {"membership_id": str(membership_id)},
    )
