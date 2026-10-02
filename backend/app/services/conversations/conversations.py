import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.rbac import Permission, has_permission
from app.models.enums import ConversationState, HandoffReason, HandoffStatus, MemberRole, Priority
from app.models.instagram import Conversation
from app.models.ops import HumanHandoff
from app.services.audit import record_audit
from app.services.tenancy import TenantContext

# A conversation the AI is not allowed to keep answering in.
_HUMAN_STATES = frozenset({ConversationState.HUMAN_REQUIRED, ConversationState.HUMAN_ACTIVE})


async def get_or_create_conversation(
    session: AsyncSession,
    organization_id: uuid.UUID,
    instagram_account_id: uuid.UUID,
    customer_id: uuid.UUID,
) -> Conversation:
    await session.execute(
        insert(Conversation)
        .values(
            organization_id=organization_id,
            instagram_account_id=instagram_account_id,
            customer_id=customer_id,
            state=ConversationState.AI_ACTIVE,
        )
        .on_conflict_do_nothing(
            index_elements=["instagram_account_id", "customer_id"],
            index_where=Conversation.deleted_at.is_(None),
        )
    )
    return (
        await session.execute(
            select(Conversation).where(
                Conversation.instagram_account_id == instagram_account_id,
                Conversation.customer_id == customer_id,
                Conversation.deleted_at.is_(None),
            )
        )
    ).scalar_one()


def is_ai_silenced(conversation: Conversation) -> bool:
    return conversation.state in _HUMAN_STATES


async def get_conversation_for_tenant(
    session: AsyncSession, tenant: TenantContext, conversation_id: uuid.UUID
) -> Conversation:
    conversation = (
        await session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.organization_id == tenant.organization_id,
                Conversation.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if conversation is None:
        raise AppError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404)
    if tenant.role is MemberRole.STAFF and conversation.assigned_user_id != tenant.user_id:
        raise AppError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404)
    return conversation


async def request_human_handoff(
    session: AsyncSession,
    conversation: Conversation,
    organization_id: uuid.UUID,
    reason: HandoffReason,
) -> None:
    """Idempotent: does nothing if a human is already engaged, so repeated triggers (e.g. two
    consecutive messages both flagged as complaints) don't create duplicate handoffs."""
    if is_ai_silenced(conversation):
        return
    conversation.state = ConversationState.HUMAN_REQUIRED
    if reason in (
        HandoffReason.COMPLAINT,
        HandoffReason.THREAT,
        HandoffReason.LEGAL,
        HandoffReason.REFUND_DISPUTE,
    ):
        conversation.priority = Priority.HIGH
    session.add(
        HumanHandoff(
            organization_id=organization_id,
            conversation_id=conversation.id,
            reason=reason,
            status=HandoffStatus.OPEN,
        )
    )
    record_audit(
        session,
        "conversation.human_required",
        organization_id,
        None,
        {"conversation_id": str(conversation.id), "reason": reason.value},
    )


async def take_over(
    session: AsyncSession, tenant: TenantContext, conversation: Conversation
) -> Conversation:
    conversation.state = ConversationState.HUMAN_ACTIVE
    conversation.assigned_user_id = tenant.user_id
    record_audit(
        session,
        "conversation.human_takeover",
        tenant.organization_id,
        tenant.user_id,
        {"conversation_id": str(conversation.id)},
    )
    return conversation


async def hand_back_to_ai(
    session: AsyncSession, tenant: TenantContext, conversation: Conversation
) -> Conversation:
    conversation.state = ConversationState.AI_ACTIVE
    record_audit(
        session,
        "conversation.handed_back_to_ai",
        tenant.organization_id,
        tenant.user_id,
        {"conversation_id": str(conversation.id)},
    )
    return conversation


async def resolve(
    session: AsyncSession, tenant: TenantContext, conversation: Conversation
) -> Conversation:
    conversation.state = ConversationState.RESOLVED
    record_audit(
        session,
        "conversation.resolved",
        tenant.organization_id,
        tenant.user_id,
        {"conversation_id": str(conversation.id)},
    )
    return conversation


def can_view_all_conversations(role: MemberRole) -> bool:
    return has_permission(role, Permission.CONVERSATIONS_ALL)
