import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings
from app.models.enums import MessageDirection, MessageOrigin
from app.models.instagram import Conversation, Message
from app.services.ai.usage import record_usage
from app.services.conversations.conversations import request_human_handoff
from app.services.moderation.classifier import ModerationClassifier
from app.services.moderation.policy import decide
from app.services.moderation.rules import check_rules
from app.services.moderation.types import Decision

PURPOSE = "moderation"


async def moderate_message(
    session: AsyncSession,
    classifier: ModerationClassifier,
    settings: Settings,
    message_id: uuid.UUID,
) -> Decision | None:
    """Classify one inbound customer message and persist the outcome on it.

    Idempotent (a message already carrying a verdict is left alone). Raises AIGatewayError when no
    provider could answer; the message then stays unmoderated, which reply generation must treat
    as "do not answer".
    """
    message = await session.get(Message, message_id)
    if (
        message is None
        or message.moderation is not None
        or message.direction is not MessageDirection.INBOUND
        or message.origin is not MessageOrigin.CUSTOMER
    ):
        return None

    verdict = check_rules(message.body, settings)
    if verdict is None:
        verdict, completion = await classifier.classify(message.body, str(message.organization_id))
        record_usage(
            session,
            message.organization_id,
            PURPOSE,
            completion,
            conversation_id=message.conversation_id,
        )
    decision = decide(verdict, settings.moderation_min_confidence)

    message.moderation = decision.as_record()
    if decision.intent is not None:
        message.intent = decision.intent
        conversation = await session.get(Conversation, message.conversation_id)
        if conversation is not None:
            conversation.last_intent = decision.intent
            if decision.handoff_reason is not None:
                await request_human_handoff(
                    session, conversation, message.organization_id, decision.handoff_reason
                )
    return decision
