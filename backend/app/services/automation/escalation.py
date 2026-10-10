import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DeliveryStatus, HandoffReason, MessageOrigin
from app.models.instagram import Conversation, Message
from app.services.conversations.conversations import request_human_handoff


async def escalate_conversation_of(
    session: AsyncSession, message_id: uuid.UUID, reason: HandoffReason
) -> None:
    """Ask a human to take the conversation a message belongs to. Used when automation gives up
    on a customer, so nobody is left waiting for an answer that will never come. Idempotent:
    does nothing if a human is already engaged."""
    message = await session.get(Message, message_id)
    if message is None:
        return
    conversation = await session.get(Conversation, message.conversation_id)
    if conversation is not None:
        await request_human_handoff(session, conversation, message.organization_id, reason)


async def fail_delivery(session: AsyncSession, message: Message) -> None:
    """Record that a message will never be delivered. If the AI wrote it, a human is asked to
    answer instead (a human-written message already has a person watching its conversation)."""
    message.status = DeliveryStatus.FAILED
    if message.origin is MessageOrigin.AI:
        await escalate_conversation_of(session, message.id, HandoffReason.MANUAL)
