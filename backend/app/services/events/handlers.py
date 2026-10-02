"""Webhook event handlers: turn a persisted comment/message event into customer + conversation
+ message rows. Registered into app.services.events.dispatch; imported once by
app.workers.settings so the registration side effect runs before the worker starts.
"""

import uuid
from collections.abc import Awaitable, Callable

import structlog

from app.core.locks import locked
from app.models.enums import DeliveryStatus, MessageDirection, MessageOrigin
from app.models.instagram import WebhookEvent
from app.services.conversations.conversations import get_or_create_conversation
from app.services.conversations.customers import get_or_create_customer
from app.services.conversations.messages import record_message, resolve_account_external_id
from app.services.events.dispatch import EventContext, register

logger = structlog.get_logger(__name__)

_LOCK_TTL_SECONDS = 15.0
_LOCK_WAIT_SECONDS = 5.0


def _conversation_lock_key(instagram_account_id: uuid.UUID, external_user_id: str) -> str:
    return f"instomation:conv_lock:{instagram_account_id}:{external_user_id}"


async def _with_conversation_lock(
    ctx: EventContext,
    instagram_account_id: uuid.UUID,
    external_user_id: str,
    work: Callable[[], Awaitable[None]],
) -> None:
    """Serializes all processing for one customer's conversation, so messages that arrive close
    together are recorded (and, in later phases, replied to) in the order they arrived."""
    async with locked(
        ctx.redis,
        _conversation_lock_key(instagram_account_id, external_user_id),
        ttl_seconds=_LOCK_TTL_SECONDS,
        wait_seconds=_LOCK_WAIT_SECONDS,
    ):
        await work()


@register("message")
async def handle_message(ctx: EventContext, event: WebhookEvent) -> None:
    if event.organization_id is None or event.instagram_account_id is None:
        logger.info("webhook_event_unowned_account", event_id=str(event.id))
        return
    organization_id, instagram_account_id = event.organization_id, event.instagram_account_id
    data = event.payload_json
    sender_id = (data.get("sender") or {}).get("id")
    recipient_id = (data.get("recipient") or {}).get("id")
    message = data.get("message") or {}
    text = message.get("text")
    mid = message.get("mid")
    if not sender_id or not text or not mid:
        return

    own_external_id = await resolve_account_external_id(ctx.session, instagram_account_id)
    if sender_id == own_external_id:
        # Echo of a message this app sent, delivered back through the webhook. It was already
        # recorded as an outbound message when we sent it — recording it again would duplicate it.
        return
    if recipient_id != own_external_id:
        return  # not addressed to this connected account

    async def work() -> None:
        customer = await get_or_create_customer(
            ctx.session, organization_id, instagram_account_id, sender_id
        )
        conversation = await get_or_create_conversation(
            ctx.session, organization_id, instagram_account_id, customer.id
        )
        await record_message(
            ctx.session,
            organization_id,
            instagram_account_id,
            conversation,
            direction=MessageDirection.INBOUND,
            origin=MessageOrigin.CUSTOMER,
            body=text,
            status=DeliveryStatus.RECEIVED,
            external_message_id=mid,
        )

    await _with_conversation_lock(ctx, instagram_account_id, sender_id, work)


@register("comments")
async def handle_comment(ctx: EventContext, event: WebhookEvent) -> None:
    if event.organization_id is None or event.instagram_account_id is None:
        logger.info("webhook_event_unowned_account", event_id=str(event.id))
        return
    organization_id, instagram_account_id = event.organization_id, event.instagram_account_id
    data = event.payload_json
    comment_id = data.get("id")
    text = data.get("text")
    author = data.get("from") or {}
    author_id = author.get("id")
    if not comment_id or text is None or not author_id:
        return

    own_external_id = await resolve_account_external_id(ctx.session, instagram_account_id)
    if author_id == own_external_id:
        return  # our own comment reply, echoed back

    async def work() -> None:
        customer = await get_or_create_customer(
            ctx.session,
            organization_id,
            instagram_account_id,
            author_id,
            username=author.get("username"),
        )
        conversation = await get_or_create_conversation(
            ctx.session, organization_id, instagram_account_id, customer.id
        )
        await record_message(
            ctx.session,
            organization_id,
            instagram_account_id,
            conversation,
            direction=MessageDirection.INBOUND,
            origin=MessageOrigin.CUSTOMER,
            body=text,
            status=DeliveryStatus.RECEIVED,
            external_message_id=f"comment:{comment_id}",
        )

    await _with_conversation_lock(ctx, instagram_account_id, author_id, work)
