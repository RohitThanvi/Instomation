import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import utcnow
from app.models.enums import DeliveryStatus, MessageDirection, MessageOrigin
from app.models.instagram import Conversation, InstagramAccount, Message


async def record_message(
    session: AsyncSession,
    organization_id: uuid.UUID,
    instagram_account_id: uuid.UUID,
    conversation: Conversation,
    *,
    direction: MessageDirection,
    origin: MessageOrigin,
    body: str,
    status: DeliveryStatus,
    external_message_id: str | None = None,
    author_user_id: uuid.UUID | None = None,
) -> Message | None:
    """Insert-or-skip on `external_message_id`: a webhook redelivery must not create a duplicate
    message. Returns None when the message already exists (still update conversation bookkeeping
    once, at the point of first insert, not on the skipped duplicate)."""
    values: dict[str, Any] = {
        "organization_id": organization_id,
        "instagram_account_id": instagram_account_id,
        "conversation_id": conversation.id,
        "external_message_id": external_message_id,
        "direction": direction,
        "origin": origin,
        "body": body,
        "status": status,
        "author_user_id": author_user_id,
    }
    if external_message_id is not None:
        result = await session.execute(
            insert(Message)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["instagram_account_id", "external_message_id"])
            .returning(Message.id)
        )
        if result.first() is None:
            return None
        await session.flush()
        message = (
            await session.execute(
                select(Message).where(
                    Message.instagram_account_id == instagram_account_id,
                    Message.external_message_id == external_message_id,
                )
            )
        ).scalar_one()
    else:
        message = Message(**values)
        session.add(message)
        await session.flush()

    conversation.last_message_at = utcnow()
    if direction is MessageDirection.INBOUND:
        conversation.unread_count += 1
    return message


async def mark_read(session: AsyncSession, conversation: Conversation) -> None:
    conversation.unread_count = 0


async def resolve_account_external_id(
    session: AsyncSession, instagram_account_id: uuid.UUID
) -> str | None:
    account = await session.get(InstagramAccount, instagram_account_id)
    return account.external_account_id if account else None
