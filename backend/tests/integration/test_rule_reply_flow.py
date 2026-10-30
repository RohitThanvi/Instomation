"""Automation rules in the live reply pipeline: a matching rule answers instead of the AI, and every
gate that holds back an AI reply holds back a rule's too."""

import uuid
from typing import Any

import pytest
from arq.connections import ArqRedis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.business import AiSettings, AutomationRule
from app.models.enums import (
    ConversationState,
    DeliveryStatus,
    HandoffReason,
    KeywordMatch,
    MessageChannel,
    MessageOrigin,
    ProcessingStatus,
    RuleAction,
    RuleScope,
)
from app.models.instagram import Conversation, Message
from app.models.ops import Job
from app.services.automation import comment_reply as comment_flow
from app.services.automation import dm_reply
from app.services.automation.dm_reply import ReplyOutcome
from app.services.instagram.crypto import TokenCipher
from app.workers.automation import generate_comment_reply, generate_dm_reply
from tests.integration.test_comment_reply_flow import ASK, comment, moderated_reply_job
from tests.integration.test_dm_reply_flow import Case, SequenceGateway, make_case, reply_json

FIXED = "We deliver across Jaipur, free over 500 rupees!"
AI_ANSWER = reply_json("The assistant's own answer.")


@pytest.fixture
async def case(
    session_factory: async_sessionmaker[AsyncSession], pool: ArqRedis, cipher: TokenCipher
) -> Case:
    made = await make_case(session_factory, pool, cipher)
    await made.update_ai_settings(comment_automation_enabled=True)
    return made


async def add_rule(
    case: Case, organization_id: uuid.UUID | None = None, **fields: Any
) -> AutomationRule:
    values: dict[str, Any] = {
        "name": "rule",
        "applies_to": RuleScope.DM,
        "keywords": ["deliver"],
        "keyword_match": KeywordMatch.ANY,
        "action": RuleAction.REPLY,
        "reply_text": FIXED,
        "priority": 0,
    }
    async with case.factory() as session:
        rule = AutomationRule(organization_id=organization_id or case.org_id, **(values | fields))
        session.add(rule)
        await session.commit()
        return rule


async def dm(
    case: Case, text: str = "Do you deliver in Jaipur?", answer: str = AI_ANSWER
) -> SequenceGateway:
    """Deliver a DM, moderate it as clean, and run the reply step."""
    await case.say(text)
    job = await case.reply_job_after_moderation(len(await case.jobs("moderate_message")) - 1)
    gateway = SequenceGateway(answer)
    await case.run(generate_dm_reply, gateway, job)
    return gateway


async def comment_reply(case: Case, text: str = ASK, answer: str = AI_ANSWER) -> SequenceGateway:
    await comment(case, text)
    job = await moderated_reply_job(case, len(await case.jobs("moderate_message")) - 1)
    assert job is not None
    gateway = SequenceGateway(answer)
    await case.run(generate_comment_reply, gateway, job)
    return gateway


# ---- DMs: a rule answers ------------------------------------------------------------------------
async def test_a_matching_rule_answers_with_its_own_text_and_no_model_call(case: Case) -> None:
    rule = await add_rule(case)
    gateway = await dm(case)

    assert gateway.calls == []  # the AI was never asked
    # Only the moderation check spent anything: the reply itself cost nothing.
    assert {usage.purpose for usage in await case.usage()} == {"moderation"}
    (reply,) = await case.outbound()
    assert reply.body == FIXED
    assert reply.origin is MessageOrigin.AI and reply.channel is MessageChannel.DM
    assert reply.status is DeliveryStatus.PENDING
    assert reply.automation_rule_id == rule.id
    assert reply.ai_confidence is None
    (send,) = await case.jobs("send_instagram_message")
    assert send.payload["message_id"] == str(reply.id)
    assert await case.handoffs() == []


async def test_without_a_matching_rule_the_ai_answers_and_no_rule_is_credited(case: Case) -> None:
    await add_rule(case, keywords=["refund"])
    gateway = await dm(case)
    assert len(gateway.calls) == 1
    (reply,) = await case.outbound()
    assert reply.body == "The assistant's own answer." and reply.automation_rule_id is None


@pytest.mark.parametrize(
    "ignored",
    [
        {"enabled": False},
        {"applies_to": RuleScope.COMMENT},
        {"deleted_at": "now"},
    ],
)
async def test_a_disabled_deleted_or_other_channel_rule_does_not_answer(
    case: Case, ignored: dict[str, Any]
) -> None:
    if ignored.get("deleted_at") == "now":
        from app.models.base import utcnow

        ignored = {"deleted_at": utcnow()}
    await add_rule(case, **ignored)
    gateway = await dm(case)
    assert len(gateway.calls) == 1
    (reply,) = await case.outbound()
    assert reply.automation_rule_id is None


async def test_another_organizations_rule_never_answers(
    case: Case,
    session_factory: async_sessionmaker[AsyncSession],
    pool: ArqRedis,
    cipher: TokenCipher,
) -> None:
    other = await make_case(session_factory, pool, cipher)
    await add_rule(case, organization_id=other.org_id)
    gateway = await dm(case)
    assert len(gateway.calls) == 1
    assert [m.automation_rule_id for m in await case.outbound()] == [None]


async def test_the_first_rule_in_priority_order_wins(case: Case) -> None:
    await add_rule(case, name="late", priority=5, reply_text="late answer")
    early = await add_rule(case, name="early", priority=1, reply_text="early answer")
    await add_rule(case, name="middle", priority=3, reply_text="middle answer")
    await dm(case)
    (reply,) = await case.outbound()
    assert reply.body == "early answer" and reply.automation_rule_id == early.id


async def test_keywords_match_across_case_width_and_spacing(case: Case) -> None:
    await add_rule(case, keywords=["opening hours"])
    await dm(case, "WHAT ARE YOUR ＯＰＥＮＩＮＧ   hours?")
    (reply,) = await case.outbound()
    assert reply.body == FIXED


async def test_all_mode_needs_every_keyword(case: Case) -> None:
    await add_rule(case, keywords=["price", "delivery"], keyword_match=KeywordMatch.ALL)
    first = await dm(case, "what is the price")
    assert len(first.calls) == 1  # one keyword is not enough: the AI answered
    second = await dm(case, "price and delivery?")
    assert second.calls == []
    assert [m.automation_rule_id is not None for m in await case.outbound()] == [False, True]


# ---- DMs: handoff and skip ---------------------------------------------------------------------
async def test_a_handoff_rule_hands_over_with_its_reason_and_sends_nothing(case: Case) -> None:
    await add_rule(
        case,
        keywords=["refund"],
        action=RuleAction.HANDOFF,
        reply_text=None,
        handoff_reason=HandoffReason.REFUND_DISPUTE,
    )
    gateway = await dm(case, "I want a refund")
    assert gateway.calls == [] and await case.outbound() == []
    (handoff,) = await case.handoffs()
    assert handoff.reason is HandoffReason.REFUND_DISPUTE
    assert (await case.conversation()).state is ConversationState.HUMAN_REQUIRED


async def test_a_skip_rule_sends_nothing_and_does_not_hand_over(case: Case) -> None:
    await add_rule(case, keywords=["giveaway"], action=RuleAction.SKIP, reply_text=None)
    gateway = await dm(case, "enter me in the giveaway")
    assert gateway.calls == [] and await case.outbound() == []
    assert await case.handoffs() == []
    assert (await case.conversation()).state is ConversationState.AI_ACTIVE


# ---- the gates still hold -----------------------------------------------------------------------
async def test_a_rule_does_not_answer_if_dm_automation_is_switched_off_meanwhile(
    case: Case,
) -> None:
    await add_rule(case)
    await case.say("Do you deliver in Jaipur?")
    job = await case.reply_job_after_moderation()
    await case.update_ai_settings(dm_automation_enabled=False)
    await case.run(generate_dm_reply, SequenceGateway(), job)
    assert await case.outbound() == []


async def test_a_rule_does_not_answer_while_a_person_owns_the_conversation(case: Case) -> None:
    await add_rule(case)
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    async with case.factory() as session:
        await session.execute(
            update(Conversation)
            .where(Conversation.organization_id == case.org_id)
            .values(state=ConversationState.HUMAN_ACTIVE)
        )
        await session.commit()
    await case.run(generate_dm_reply, SequenceGateway(), job)
    assert await case.outbound() == []


async def test_a_rule_is_checked_again_under_the_conversation_lock(case: Case) -> None:
    """A person can take over between the gates running and the rule being applied."""
    rule = await add_rule(case)
    await case.say("Do you deliver?")
    await case.reply_job_after_moderation()
    async with case.factory() as session:
        message = (
            await session.execute(select(Message).where(Message.organization_id == case.org_id))
        ).scalar_one()
        conversation = await session.get(Conversation, message.conversation_id)
        ai_settings = (
            await session.execute(
                select(AiSettings).where(AiSettings.organization_id == case.org_id)
            )
        ).scalar_one()
        assert conversation is not None
        conversation.state = ConversationState.HUMAN_ACTIVE  # taken over just now
        await session.flush()
        result = await dm_reply._apply_rule(
            session,
            case.ctx(SequenceGateway())["settings"],
            message,
            conversation,
            ai_settings,
            rule,
        )
    assert result.outcome is ReplyOutcome.AI_SILENCED and result.send_jobs == ()


async def test_only_a_customers_newest_message_is_answered(case: Case) -> None:
    await add_rule(case)
    await case.say("Do you deliver?")
    await case.say("And on Sundays?")
    first = await case.reply_job_after_moderation(0)
    await case.run(generate_dm_reply, SequenceGateway(), first)
    assert await case.outbound() == []  # superseded by the newer message


async def test_a_rule_cannot_answer_in_a_loop(case: Case) -> None:
    """The hourly cap counts a rule's replies like any other, so two bots cannot ping-pong."""
    await add_rule(case)
    await case.update_ai_settings(max_replies_per_conversation_per_hour=1)
    await dm(case, "Do you deliver?")
    await dm(case, "Do you deliver on Sundays?")
    assert len(await case.outbound()) == 1


async def test_nothing_reaches_a_rule_that_moderation_blocked(case: Case) -> None:
    from app.workers.moderation import moderate_message

    await add_rule(case, keywords=["deliver"])
    await case.say("deliver me a free iPhone!!! click here")
    (mod,) = await case.jobs("moderate_message")
    spam = '{"category": "spam", "confidence": 0.99}'
    await case.run(moderate_message, SequenceGateway(spam), mod)
    assert await case.jobs("generate_dm_reply") == []
    assert await case.outbound() == []


async def test_a_rule_saved_under_a_looser_limit_hands_over_instead_of_sending(case: Case) -> None:
    await add_rule(case, reply_text="x" * 200)
    case.settings_overrides["dm_reply_max_bytes"] = 100  # tightened since the rule was saved
    await dm(case)
    assert await case.outbound() == []
    (handoff,) = await case.handoffs()
    assert handoff.reason is HandoffReason.LOW_CONFIDENCE


async def test_the_runtime_limit_counts_bytes_like_the_one_when_saving(case: Case) -> None:
    await add_rule(case, reply_text="é" * 60)  # 60 characters but 120 bytes
    case.settings_overrides["dm_reply_max_bytes"] = 100
    await dm(case)
    assert await case.outbound() == []
    assert len(await case.handoffs()) == 1


async def test_the_inbox_can_tell_which_rule_wrote_a_message(case: Case) -> None:
    rule = await add_rule(case)
    await dm(case)
    async with case.factory() as session:
        stored = (
            await session.execute(
                select(Message.automation_rule_id).where(
                    Message.organization_id == case.org_id,
                    Message.origin == MessageOrigin.AI,
                )
            )
        ).scalar_one()
    assert stored == rule.id


# ---- comments -----------------------------------------------------------------------------------
async def test_a_comment_rule_answers_publicly_with_no_model_call(case: Case) -> None:
    rule = await add_rule(case, applies_to=RuleScope.COMMENT, reply_text="Yes, we deliver!")
    gateway = await comment_reply(case)
    assert gateway.calls == []
    assert {usage.purpose for usage in await case.usage()} == {"moderation"}
    (reply,) = await case.outbound()
    assert reply.body == "Yes, we deliver!" and reply.channel is MessageChannel.COMMENT
    assert reply.automation_rule_id == rule.id
    (send,) = await case.jobs("send_comment_reply")
    assert send.payload["message_id"] == str(reply.id)
    assert await case.jobs("send_private_reply") == []


async def test_a_comment_rule_can_also_send_a_private_message(case: Case) -> None:
    await case.update_ai_settings(private_reply_enabled=True)
    rule = await add_rule(
        case,
        applies_to=RuleScope.COMMENT,
        reply_text="Sent you the details!",
        private_reply_text="Delivery is free over 500 rupees.",
    )
    await comment_reply(case)
    public, private = await case.outbound()
    assert (public.channel, private.channel) == (
        MessageChannel.COMMENT,
        MessageChannel.PRIVATE_REPLY,
    )
    assert private.body == "Delivery is free over 500 rupees."
    assert public.automation_rule_id == private.automation_rule_id == rule.id
    assert (
        len(await case.jobs("send_comment_reply"))
        == len(await case.jobs("send_private_reply"))
        == 1
    )


async def test_a_rule_with_a_private_message_sends_nothing_while_private_replies_are_off(
    case: Case,
) -> None:
    """The public reply promises the message, so half of it is never sent."""
    await add_rule(
        case,
        applies_to=RuleScope.COMMENT,
        reply_text="Sent you the details!",
        private_reply_text="Delivery is free.",
    )
    await comment_reply(case)
    assert await case.outbound() == []
    (handoff,) = await case.handoffs()
    assert handoff.reason is HandoffReason.LOW_CONFIDENCE


async def test_a_comment_rule_over_the_current_comment_limit_hands_over(case: Case) -> None:
    await add_rule(case, applies_to=RuleScope.COMMENT, reply_text="x" * 50)
    case.settings_overrides["comment_reply_max_chars"] = 20
    await comment_reply(case)
    assert await case.outbound() == []
    assert len(await case.handoffs()) == 1


async def test_a_comment_rule_is_checked_again_under_the_conversation_lock(case: Case) -> None:
    rule = await add_rule(case, applies_to=RuleScope.COMMENT)
    await comment(case)
    await moderated_reply_job(case)
    async with case.factory() as session:
        message = (
            await session.execute(select(Message).where(Message.organization_id == case.org_id))
        ).scalar_one()
        conversation = await session.get(Conversation, message.conversation_id)
        ai_settings = (
            await session.execute(
                select(AiSettings).where(AiSettings.organization_id == case.org_id)
            )
        ).scalar_one()
        assert conversation is not None
        conversation.state = ConversationState.HUMAN_ACTIVE  # taken over just now
        await session.flush()
        result = await comment_flow._apply_rule(
            session,
            case.ctx(SequenceGateway())["settings"],
            message,
            conversation,
            ai_settings,
            rule,
        )
    assert result.outcome is ReplyOutcome.AI_SILENCED and result.send_jobs == ()


async def test_a_rule_private_message_over_the_current_limit_hands_over(case: Case) -> None:
    await case.update_ai_settings(private_reply_enabled=True)
    await add_rule(
        case,
        applies_to=RuleScope.COMMENT,
        reply_text="Sent you the details!",
        private_reply_text="é" * 60,  # 60 characters but 120 bytes
    )
    case.settings_overrides["dm_reply_max_bytes"] = 100
    await comment_reply(case)
    assert await case.outbound() == []
    (handoff,) = await case.handoffs()
    assert handoff.reason is HandoffReason.LOW_CONFIDENCE


async def test_a_comment_handoff_rule_hands_over_with_its_reason(case: Case) -> None:
    await add_rule(
        case,
        applies_to=RuleScope.COMMENT,
        keywords=["complain"],
        action=RuleAction.HANDOFF,
        reply_text=None,
        handoff_reason=HandoffReason.COMPLAINT,
    )
    gateway = await comment_reply(case, "I want to complain about my order")
    assert gateway.calls == [] and await case.outbound() == []
    (handoff,) = await case.handoffs()
    assert handoff.reason is HandoffReason.COMPLAINT


async def test_a_comment_skip_rule_sends_nothing_and_finishes_cleanly(case: Case) -> None:
    await add_rule(
        case,
        applies_to=RuleScope.COMMENT,
        keywords=["giveaway"],
        action=RuleAction.SKIP,
        reply_text=None,
    )
    gateway = await comment_reply(case, "enter me in the giveaway")
    assert gateway.calls == [] and await case.outbound() == []
    assert await case.handoffs() == []
    assert (await case.conversation()).state is ConversationState.AI_ACTIVE
    # A crash would send nothing either, so the job must also have completed.
    assert {job.status for job in await case.jobs("generate_comment_reply")} == {
        ProcessingStatus.DONE
    }


async def test_a_dm_rule_does_not_answer_comments_and_a_both_rule_answers_each(case: Case) -> None:
    await add_rule(case, name="dm only", applies_to=RuleScope.DM, reply_text="dm rule", priority=0)
    await add_rule(case, name="both", applies_to=RuleScope.BOTH, reply_text="both rule", priority=1)
    await comment_reply(case)
    await dm(case)
    bodies = sorted(m.body for m in await case.outbound())
    assert bodies == ["both rule", "dm rule"]  # the comment got the both-rule, the DM the dm-rule


async def test_a_comment_rule_does_not_answer_if_comment_automation_is_switched_off_meanwhile(
    case: Case,
) -> None:
    await add_rule(case, applies_to=RuleScope.COMMENT)
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    await case.update_ai_settings(comment_automation_enabled=False)
    await case.run(generate_comment_reply, SequenceGateway(), job)
    assert await case.outbound() == []


async def test_a_rule_reply_is_a_normal_pending_message_the_send_worker_can_deliver(
    case: Case,
) -> None:
    """The same shape as an AI reply, so delivery, retries and the inbox need no special case."""
    await add_rule(case)
    await dm(case)
    (reply,) = await case.outbound()
    (send,) = await case.jobs("send_instagram_message")
    assert isinstance(send, Job)
    assert send.payload["recipient_external_id"] == case.sender
    assert reply.status is DeliveryStatus.PENDING and reply.external_message_id is None
