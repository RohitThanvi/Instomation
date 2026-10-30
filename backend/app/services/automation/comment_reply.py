import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings
from app.models.base import utcnow
from app.models.business import AiSettings, AutomationRule, BusinessProfile
from app.models.enums import (
    DeliveryStatus,
    HandoffReason,
    MessageChannel,
    MessageDirection,
    MessageOrigin,
    RuleAction,
    RuleScope,
)
from app.models.instagram import Conversation, Message
from app.models.ops import Job
from app.services.ai.gateway import AIGateway
from app.services.ai.provider import AIMessage
from app.services.ai.structured import parse_model
from app.services.ai.usage import record_usage
from app.services.automation.dm_reply import (
    APPROVED,
    ModelReply,
    ReplyOutcome,
    ReplyResult,
    escalation_reason,
    retrieve_knowledge,
)
from app.services.automation.prompt import build_prompt
from app.services.automation.rules import matching_rule
from app.services.conversations.conversations import is_ai_silenced, request_human_handoff
from app.services.conversations.messages import COMMENT_ID_PREFIX, record_message
from app.services.instagram.capabilities import Capabilities, Feature
from app.workers.jobs import add_job
from app.workers.queues import QueueName

PURPOSE = "comment_reply"
SEND_FUNCTION = "send_comment_reply"
PRIVATE_SEND_FUNCTION = "send_private_reply"


class ModelCommentReply(ModelReply):
    """A comment answer: the public reply, plus an optional private message when the owner has
    allowed it. Ignored (never sent) when private replies are off, whatever the model wrote."""

    private_reply: str = ""


def _private_replies_allowed(ai_settings: AiSettings, settings: Settings) -> bool:
    return ai_settings.private_reply_enabled and Capabilities(settings).is_enabled(
        Feature.PRIVATE_REPLY
    )


async def _skip_reason(
    session: AsyncSession,
    message: Message,
    conversation: Conversation,
    ai_settings: AiSettings | None,
    settings: Settings,
) -> ReplyOutcome | None:
    """Every reason NOT to reply publicly; checked before the model call and again under the
    conversation lock right before the reply is recorded."""
    if not (message.external_message_id or "").startswith(COMMENT_ID_PREFIX):
        return ReplyOutcome.NOT_APPLICABLE
    if not message.moderation or message.moderation.get("action") != APPROVED:
        return ReplyOutcome.NOT_CLEARED
    if ai_settings is None or not ai_settings.comment_automation_enabled:
        return ReplyOutcome.AUTOMATION_OFF
    if is_ai_silenced(conversation):
        return ReplyOutcome.AI_SILENCED  # a person is handling this customer
    now = utcnow()
    if now - message.created_at > timedelta(hours=settings.comment_reply_window_hours):
        return ReplyOutcome.WINDOW_EXPIRED

    # Comments on different posts interleave in one conversation, so "already answered" cannot be
    # inferred from message order: the send job created with the reply is the record.
    answered = await session.scalar(
        select(func.count())
        .select_from(Job)
        .where(
            Job.organization_id == message.organization_id,
            Job.kind == SEND_FUNCTION,
            Job.payload["comment_message_id"].as_string() == str(message.id),
        )
    )
    if answered:
        return ReplyOutcome.ALREADY_ANSWERED

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
        return ReplyOutcome.RATE_LIMITED
    return None


async def _queue_comment_reply(
    session: AsyncSession,
    org_id: uuid.UUID,
    conversation: Conversation,
    message: Message,
    public_text: str,
    private_text: str,
    rule_id: uuid.UUID | None,
) -> ReplyResult:
    """Record the public reply (and the private message, when there is one) as pending and queue
    their sends. `rule_id` names the automation rule that wrote them, or is None for the AI."""
    reply = await record_message(
        session,
        org_id,
        conversation.instagram_account_id,
        conversation,
        direction=MessageDirection.OUTBOUND,
        origin=MessageOrigin.AI,
        channel=MessageChannel.COMMENT,
        body=public_text,
        status=DeliveryStatus.PENDING,
        automation_rule_id=rule_id,
    )
    assert reply is not None  # no external_message_id, so never deduplicated away
    assert message.external_message_id is not None
    comment_id = message.external_message_id.removeprefix(COMMENT_ID_PREFIX)

    async def queue_send(function: str, sent: Message) -> Job:
        return await add_job(
            session,
            QueueName.INSTAGRAM,
            function,
            {
                "message_id": str(sent.id),
                "comment_message_id": str(message.id),
                "comment_id": comment_id,
            },
            org_id,
        )

    jobs = [await queue_send(SEND_FUNCTION, reply)]
    if private_text:
        private = await record_message(
            session,
            org_id,
            conversation.instagram_account_id,
            conversation,
            direction=MessageDirection.OUTBOUND,
            origin=MessageOrigin.AI,
            channel=MessageChannel.PRIVATE_REPLY,
            body=private_text,
            status=DeliveryStatus.PENDING,
            automation_rule_id=rule_id,
        )
        assert private is not None  # no external_message_id, so never deduplicated away
        jobs.append(await queue_send(PRIVATE_SEND_FUNCTION, private))
    return ReplyResult(ReplyOutcome.QUEUED, tuple(jobs))


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
    as for an AI reply. A rule that cannot be carried out in full hands over rather than send half:
    the public reply of a rule with a private message promises that message.
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
    public_text = rule.reply_text
    assert public_text is not None  # ck_automation_rules_action_fields
    private_text = rule.private_reply_text or ""
    can_send_all = len(public_text) <= settings.comment_reply_max_chars and (
        not private_text
        or (
            _private_replies_allowed(ai_settings, settings)
            and len(private_text.encode()) <= settings.dm_reply_max_bytes
        )
    )
    if not can_send_all:
        await request_human_handoff(session, conversation, org_id, HandoffReason.LOW_CONFIDENCE)
        return ReplyResult(ReplyOutcome.HANDED_OFF)
    return await _queue_comment_reply(
        session, org_id, conversation, message, public_text, private_text, rule.id
    )


async def generate_comment_reply(
    session: AsyncSession, gateway: AIGateway, settings: Settings, message_id: uuid.UUID
) -> ReplyResult:
    """Answer one moderated comment with a short public reply, or decide not to.

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
        RuleScope.COMMENT,
        message.body,
    )
    if rule is not None:
        return await _apply_rule(session, settings, message, conversation, ai_settings, rule)

    profile = (
        await session.execute(
            select(BusinessProfile).where(BusinessProfile.organization_id == org_id)
        )
    ).scalar_one_or_none()
    private_allowed = _private_replies_allowed(ai_settings, settings)
    prompt = build_prompt(
        profile,
        await retrieve_knowledge(session, settings, org_id, message.body),
        max_chars=settings.comment_reply_max_chars,
        channel="comment",
        # The same ceiling a DM is held to: Instagram accepts one message, at most 1000 bytes.
        private_max_chars=settings.dm_reply_max_bytes // 4 if private_allowed else None,
    )
    completion = await gateway.complete(
        [AIMessage("system", prompt.system), AIMessage("user", message.body)],
        max_tokens=ai_settings.max_response_tokens + settings.dm_reply_json_overhead_tokens,
        temperature=ai_settings.temperature,
        organization_id=str(org_id),
    )
    record_usage(session, org_id, PURPOSE, completion, conversation_id=conversation.id)
    parsed = parse_model(completion.text, ModelCommentReply)
    escalation = escalation_reason(
        parsed,
        prompt,
        ai_settings,
        max_bytes=settings.comment_reply_max_chars * 4,  # worst-case UTF-8 width
        max_chars=settings.comment_reply_max_chars,
    )
    private_text = parsed.private_reply.strip() if parsed is not None and private_allowed else ""
    if escalation is None and parsed is not None and private_text:
        # The private message is held to every check a DM is. If it fails any, nothing is sent:
        # the public reply promises a message, so a half-sent answer is worse than a handoff.
        escalation = escalation_reason(
            ModelReply(reply=private_text, confidence=parsed.confidence, needs_human=False),
            prompt,
            ai_settings,
            max_bytes=settings.dm_reply_max_bytes,
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

    return await _queue_comment_reply(
        session, org_id, conversation, message, parsed.reply.strip(), private_text, None
    )
