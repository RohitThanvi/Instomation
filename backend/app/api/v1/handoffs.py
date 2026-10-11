from typing import Annotated, Any

from fastapi import APIRouter, Query
from sqlalchemy import Select, func, select

from app.api.deps import SessionDep, Tenant
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page, keyset_page
from app.models.enums import HandoffStatus, MemberRole
from app.models.instagram import Conversation, Customer
from app.models.ops import HumanHandoff
from app.schemas.conversations import CustomerOut
from app.schemas.handoffs import HandoffCounts, HandoffOut
from app.services.tenancy import TenantContext

router = APIRouter(prefix="/handoffs", tags=["handoffs"])

Cursor = Annotated[str | None, Query(max_length=200)]
Limit = Annotated[int, Query(ge=1, le=MAX_LIMIT)]
_UNRESOLVED = (HandoffStatus.OPEN, HandoffStatus.ASSIGNED)


def _scope[S: Select[Any]](stmt: S, tenant: TenantContext) -> S:
    """Tenant isolation, and staff only see handoffs on conversations assigned to them (the same
    rule as the conversation list)."""
    stmt = stmt.where(
        HumanHandoff.organization_id == tenant.organization_id,
        Conversation.deleted_at.is_(None),
    )
    if tenant.role is MemberRole.STAFF:
        stmt = stmt.where(Conversation.assigned_user_id == tenant.user_id)
    return stmt


@router.get("", response_model=Page[HandoffOut])
async def list_handoffs(
    tenant: Tenant,
    session: SessionDep,
    cursor: Cursor = None,
    limit: Limit = DEFAULT_LIMIT,
    status: HandoffStatus | None = None,
) -> Page[HandoffOut]:
    """The queue of conversations that need a person, longest-waiting first. Without `status`
    it lists unresolved handoffs (open and assigned)."""
    stmt = _scope(
        select(HumanHandoff, Conversation, Customer)
        .join(Conversation, Conversation.id == HumanHandoff.conversation_id)
        .join(Customer, Customer.id == Conversation.customer_id),
        tenant,
    )
    stmt = stmt.where(
        HumanHandoff.status == status
        if status is not None
        else HumanHandoff.status.in_(_UNRESOLVED)
    )
    rows, next_cursor = await keyset_page(
        session,
        stmt,
        HumanHandoff.created_at,
        HumanHandoff.id,
        lambda row: (row[0].created_at, row[0].id),
        cursor,
        limit,
    )
    items = [
        HandoffOut(
            id=handoff.id,
            conversation_id=conversation.id,
            customer=CustomerOut(
                id=customer.id,
                external_user_id=customer.external_user_id,
                username=customer.username,
                display_name=customer.display_name,
            ),
            conversation_state=conversation.state,
            conversation_priority=conversation.priority,
            reason=handoff.reason,
            status=handoff.status,
            assigned_user_id=handoff.assigned_user_id,
            created_at=handoff.created_at,
            resolved_at=handoff.resolved_at,
        )
        for handoff, conversation, customer in rows
    ]
    return Page[HandoffOut](items=items, next_cursor=next_cursor)


@router.get("/counts", response_model=HandoffCounts)
async def handoff_counts(tenant: Tenant, session: SessionDep) -> HandoffCounts:
    """For a badge: how many handoffs are waiting for a person or being handled."""
    stmt = _scope(
        select(HumanHandoff.status, func.count())
        .join(Conversation, Conversation.id == HumanHandoff.conversation_id)
        .where(HumanHandoff.status.in_(_UNRESOLVED))
        .group_by(HumanHandoff.status),
        tenant,
    )
    counts = {status: total for status, total in (await session.execute(stmt)).all()}
    return HandoffCounts(
        open=counts.get(HandoffStatus.OPEN, 0), assigned=counts.get(HandoffStatus.ASSIGNED, 0)
    )
