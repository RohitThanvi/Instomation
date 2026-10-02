import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.enums import DeliveryStatus, MemberRole, MessageDirection, MessageOrigin
from app.models.instagram import Conversation, Customer, InstagramAccount
from app.services.audit import record_audit
from app.services.conversations.conversations import get_conversation_for_tenant, is_ai_silenced
from app.services.conversations.messages import record_message
from app.services.tenancy import TenantContext
from app.workers.queue import JobQueue
from app.workers.queues import QueueName


async def send_human_reply(
    session: AsyncSession,
    job_queue: JobQueue,
    tenant: TenantContext,
    conversation_id: uuid.UUID,
    body: str,
) -> tuple[Conversation, object]:
    """Records the outbound message immediately (visible in the inbox right away) and hands the
    actual Instagram API call to the `instagram` queue, so a slow or failed send never blocks the
    HTTP response. A human may only reply while the conversation is in a human-controlled state —
    replying while the AI is active would race with automated responses."""
    conversation = await get_conversation_for_tenant(session, tenant, conversation_id)
    if tenant.role is MemberRole.STAFF and conversation.assigned_user_id != tenant.user_id:
        raise AppError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404)
    if not is_ai_silenced(conversation):
        raise AppError(
            "CONVERSATION_NOT_HUMAN_CONTROLLED",
            "Take over this conversation before sending a manual reply.",
            409,
        )

    message = await record_message(
        session,
        tenant.organization_id,
        conversation.instagram_account_id,
        conversation,
        direction=MessageDirection.OUTBOUND,
        origin=MessageOrigin.HUMAN,
        body=body,
        status=DeliveryStatus.PENDING,
        author_user_id=tenant.user_id,
    )
    assert message is not None  # no external_message_id on this path, so never deduplicated away
    await session.flush()

    customer = await session.get(Customer, conversation.customer_id)
    assert customer is not None
    await job_queue.enqueue(
        QueueName.INSTAGRAM,
        "send_instagram_message",
        {
            "message_id": str(message.id),
            "instagram_account_id": str(conversation.instagram_account_id),
            "recipient_external_id": customer.external_user_id,
        },
        organization_id=tenant.organization_id,
    )
    record_audit(
        session,
        "conversation.manual_reply_queued",
        tenant.organization_id,
        tenant.user_id,
        {"conversation_id": str(conversation.id), "message_id": str(message.id)},
    )
    return conversation, message


async def resolve_instagram_account_token_context(
    session: AsyncSession, instagram_account_id: uuid.UUID
) -> InstagramAccount | None:
    return (
        await session.execute(
            select(InstagramAccount).where(InstagramAccount.id == instagram_account_id)
        )
    ).scalar_one_or_none()
