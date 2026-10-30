import uuid
from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum

from pydantic import BaseModel, Field
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings
from app.models.base import utcnow
from app.models.business import AiSettings, AutomationRule, BusinessProfile, KnowledgeEntry
from app.models.enums import (
    DeliveryStatus,
    HandoffReason,
    MessageChannel,
    MessageDirection,
    MessageOrigin,
    RuleAction,
    RuleScope,
)
from app.models.instagram import Conversation, Customer, Message
from app.models.ops import Job
from app.services.ai.gateway import AIGateway
from app.services.ai.provider import AIMessage
from app.services.ai.structured import parse_model
from app.services.ai.usage import record_usage
from app.services.automation.prompt import PromptContext, build_prompt, disallowed_urls
from app.services.automation.rules import matching_rule
from app.services.conversations.conversations import is_ai_silenced, request_human_handoff
from app.services.conversations.messages import COMMENT_ID_PREFIX, record_message
from app.services.knowledge.search import search_entries
from app.workers.jobs import add_job
from app.workers.queues import QueueName

PURPOSE = "dm_reply"
APPROVED = "allow"


class ReplyOutcome(StrEnum):
    QUEUED = "queued"  # reply recorded and handed to the instagram queue
    HANDED_OFF = "handed_off"  # AI declined; a human was asked to answer
    NOT_APPLICABLE = "not_applicable"
    NOT_CLEARED = "not_cleared"  # not moderated as "allow": never answer
    AUTOMATION_OFF = "automation_off"
    AI_SILENCED = "ai_silenced"  # a human owns the conversation (or it needs one)
    WINDOW_EXPIRED = "window_expired"
    ALREADY_ANSWERED = "already_answered"
    SUPERSEDED = "superseded"  # a newer customer message will be answered instead
    RATE_LIMITED = "rate_limited"
    RULE_SKIPPED = "rule_skipped"  # an automation rule says to send nothing


@dataclass(frozen=True, slots=True)
class ReplyResult:
    outcome: ReplyOutcome
    send_jobs: tuple[Job, ...] = ()


class ModelReply(BaseModel, extra="forbid"):
    reply: str
    confidence: float = Field(ge=0.0, le=1.0)
    needs_human: bool


async def _skip_reason(
    session: AsyncSession,
    message: Message,
    conversation: Conversation,
    ai_settings: AiSettings | None,
    settings: Settings,
) -> ReplyOutcome | None:
    """Every reason NOT to answer. Evaluated before generating and again, under the conversation
    lock, immediately before the reply is recorded (state can change while the model runs)."""
    if (message.external_message_id or "").startswith(COMMENT_ID_PREFIX):
        return ReplyOutcome.NOT_APPLICABLE  # a comment is answered publicly, never by DM
    if not message.moderation or message.moderation.get("action") != APPROVED:
        return ReplyOutcome.NOT_CLEARED
    if ai_settings is None or not ai_settings.dm_automation_enabled:
        return ReplyOutcome.AUTOMATION_OFF
    if is_ai_silenced(conversation):
        return ReplyOutcome.AI_SILENCED
    now = utcnow()
    if now - message.created_at > timedelta(hours=settings.dm_reply_window_hours):
        return ReplyOutcome.WINDOW_EXPIRED

    answered = exists().where(
        Message.conversation_id == conversation.id,
        Message.direction == MessageDirection.OUTBOUND,
        Message.origin.in_([MessageOrigin.AI, MessageOrigin.HUMAN]),
        Message.created_at > message.created_at,
    )
    if await session.scalar(select(answered)):
        return ReplyOutcome.ALREADY_ANSWERED

    # A newer message that is (or may yet be) answerable gets the single reply, with the whole
    # exchange as context. One that was blocked or escalated does not take the reply from this one.
    newer = exists().where(
        Message.conversation_id == conversation.id,
        Message.direction == MessageDirection.INBOUND,
        Message.origin == MessageOrigin.CUSTOMER,
        Message.created_at > message.created_at,
        or_(Message.moderation.is_(None), Message.moderation["action"].as_string() == APPROVED),
    )
    if await session.scalar(select(newer)):
        return ReplyOutcome.SUPERSEDED

    recent_ai = await session.scalar(
        select(func.count())
        .select_from(Message)
        .where(
            Message.conversation_id == conversation.id,
            Message.direction == MessageDirection.OUTBOUND,
            Message.origin == MessageOrigin.AI,
            Message.created_at > now - timedelta(hours=1),
        )
    )
    if (recent_ai or 0) >= ai_settings.max_replies_per_conversation_per_hour:
        return ReplyOutcome.RATE_LIMITED  # loop protection (e.g. two auto-responders talking)
    return None


async def _recent_customer_text(session: AsyncSession, message: Message) -> str:
    """The last two customer messages: a follow-up like "and the price?" has no keywords alone."""
    rows = await session.scalars(
        select(Message.body)
        .where(
            Message.conversation_id == message.conversation_id,
            Message.direction == MessageDirection.INBOUND,
            Message.origin == MessageOrigin.CUSTOMER,
            Message.created_at <= message.created_at,
        )
        .order_by(Message.created_at.desc(), Message.id)
        .limit(2)
    )
    return " ".join(rows)


async def _history(session: AsyncSession, message: Message, settings: Settings) -> list[AIMessage]:
    rows = (
        await session.scalars(
            select(Message)
            .where(
                Message.conversation_id == message.conversation_id,
                Message.origin != MessageOrigin.INTERNAL_NOTE,
                Message.created_at <= message.created_at,
                # messages we refused to answer (spam, abuse, threats) are not conversation
                or_(
                    Message.moderation.is_(None),
                    Message.moderation["action"].as_string() == APPROVED,
                ),
            )
            .order_by(Message.created_at.desc(), Message.id)
            .limit(settings.dm_reply_history_messages)
        )
    ).all()
    return [
        AIMessage("user" if m.direction is MessageDirection.INBOUND else "assistant", m.body)
        for m in reversed(rows)
    ]


async def retrieve_knowledge(
    session: AsyncSession, settings: Settings, organization_id: uuid.UUID, query: str
) -> list[KnowledgeEntry]:
    """The organization's best-matching entries for `query` that fit the prompt budget."""
    if settings.dm_reply_knowledge_entries == 0:
        return []
    hits = await search_entries(
        session, settings, organization_id, query, settings.dm_reply_knowledge_entries
    )
    chosen: list[KnowledgeEntry] = []
    used = 0
    for hit in hits:  # best first; an entry that does not fit the budget is skipped, not cut
        size = len(hit.entry.title) + len(hit.entry.content)
        if used + size <= settings.dm_reply_knowledge_max_chars:
            chosen.append(hit.entry)
            used += size
    return chosen


def escalation_reason(
    parsed: ModelReply | None,
    prompt: PromptContext,
    ai_settings: AiSettings,
    *,
    max_bytes: int,
    max_chars: int | None = None,
) -> HandoffReason | None:
    """Fail closed: any doubt about the model's answer means a human answers instead."""
    if parsed is None:
        return HandoffReason.LOW_CONFIDENCE
    if parsed.needs_human:
        return HandoffReason.MISSING_INFORMATION
    reply = parsed.reply.strip()
    if (
        not reply
        or parsed.confidence < ai_settings.confidence_threshold
        or len(reply.encode()) > max_bytes
        or (max_chars is not None and len(reply) > max_chars)
        or disallowed_urls(reply, prompt.allowed_urls)
    ):
        return HandoffReason.LOW_CONFIDENCE
    return None


async def _queue_dm_reply(
    session: AsyncSession,
    org_id: uuid.UUID,
    conversation: Conversation,
    text: str,
    rule_id: uuid.UUID | None,
) -> ReplyResult:
    """Record the reply as pending and hand it to the instagram queue. `rule_id` names the
    automation rule that wrote it, or is None for the AI."""
    reply = await record_message(
        session,
        org_id,
        conversation.instagram_account_id,
        conversation,
        direction=MessageDirection.OUTBOUND,
        origin=MessageOrigin.AI,
        channel=MessageChannel.DM,
        body=text,
        status=DeliveryStatus.PENDING,
        automation_rule_id=rule_id,
    )
    assert reply is not None  # no external_message_id, so never deduplicated away
    customer = await session.get(Customer, conversation.customer_id)
    assert customer is not None
    job = await add_job(
        session,
        QueueName.INSTAGRAM,
        "send_instagram_message",
        {
            "message_id": str(reply.id),
            "instagram_account_id": str(conversation.instagram_account_id),
            "recipient_external_id": customer.external_user_id,
        },
        org_id,
    )
    return ReplyResult(ReplyOutcome.QUEUED, (job,))


async def _apply_rule(
    session: AsyncSession,
    settings: Settings,
    message: Message,
    conversation: Conversation,
    ai_settings: AiSettings,
    rule: AutomationRule,
) -> ReplyResult:
    """Do what a matching automation rule says instead of asking the AI.

    No model is involved, but the conversation is locked and every gate re-checked first, exactly
    as for an AI reply: a person may have taken over since the gates last ran.
    """
    org_id = message.organization_id
    await session.refresh(conversation, with_for_update=True)
    skip = await _skip_reason(session, message, conversation, ai_settings, settings)
    if skip is not None:
        return ReplyResult(skip)
    if rule.action is RuleAction.SKIP:
        return ReplyResult(ReplyOutcome.RULE_SKIPPED)
    if rule.action is RuleAction.HANDOFF:
        assert rule.handoff_reason is not None  # ck_automation_rules_action_fields
        await request_human_handoff(session, conversation, org_id, rule.handoff_reason)
        return ReplyResult(ReplyOutcome.HANDED_OFF)
    text = rule.reply_text
    assert text is not None  # ck_automation_rules_action_fields
    if len(text.encode()) > settings.dm_reply_max_bytes:
        # Saved under a looser limit than the one in force now: hand over rather than send a
        # message Instagram would refuse.
        await request_human_handoff(session, conversation, org_id, HandoffReason.LOW_CONFIDENCE)
        return ReplyResult(ReplyOutcome.HANDED_OFF)
    return await _queue_dm_reply(session, org_id, conversation, text, rule.id)


async def generate_dm_reply(
    session: AsyncSession, gateway: AIGateway, settings: Settings, message_id: uuid.UUID
) -> ReplyResult:
    """Answer one moderated inbound DM, or decide not to.

    Raises AIGatewayError when no provider could answer; the caller retries the whole job.
    """
    message = await session.get(Message, message_id)
    if (
        message is None
        or message.direction is not MessageDirection.INBOUND
        or message.origin is not MessageOrigin.CUSTOMER
    ):
        return ReplyResult(ReplyOutcome.NOT_APPLICABLE)
    conversation = await session.get(Conversation, message.conversation_id)
    if conversation is None:
        return ReplyResult(ReplyOutcome.NOT_APPLICABLE)
    org_id = message.organization_id

    ai_settings = (
        await session.execute(select(AiSettings).where(AiSettings.organization_id == org_id))
    ).scalar_one_or_none()
    skip = await _skip_reason(session, message, conversation, ai_settings, settings)
    if skip is not None:
        return ReplyResult(skip)
    assert ai_settings is not None  # guaranteed by the AUTOMATION_OFF check above

    rule = await matching_rule(
        session,
        org_id,
        RuleScope.DM,
        message.body,
    )
    if rule is not None:
        return await _apply_rule(session, settings, message, conversation, ai_settings, rule)

    profile = (
        await session.execute(
            select(BusinessProfile).where(BusinessProfile.organization_id == org_id)
        )
    ).scalar_one_or_none()
    prompt = build_prompt(
        profile,
        await retrieve_knowledge(
            session, settings, org_id, await _recent_customer_text(session, message)
        ),
        max_chars=settings.dm_reply_max_bytes // 4,  # conservative for 3-4 byte scripts
    )
    completion = await gateway.complete(
        [AIMessage("system", prompt.system), *await _history(session, message, settings)],
        max_tokens=ai_settings.max_response_tokens + settings.dm_reply_json_overhead_tokens,
        temperature=ai_settings.temperature,
        organization_id=str(org_id),
    )
    record_usage(session, org_id, PURPOSE, completion, conversation_id=conversation.id)
    parsed = parse_model(completion.text, ModelReply)
    escalation = escalation_reason(
        parsed, prompt, ai_settings, max_bytes=settings.dm_reply_max_bytes
    )

    # The model call took seconds: lock the conversation and re-check before acting on it.
    await session.refresh(conversation, with_for_update=True)
    skip = await _skip_reason(session, message, conversation, ai_settings, settings)
    if skip is not None:
        return ReplyResult(skip)
    if escalation is not None or parsed is None:
        await request_human_handoff(
            session, conversation, org_id, escalation or HandoffReason.LOW_CONFIDENCE
        )
        return ReplyResult(ReplyOutcome.HANDED_OFF)

    return await _queue_dm_reply(session, org_id, conversation, parsed.reply.strip(), None)
