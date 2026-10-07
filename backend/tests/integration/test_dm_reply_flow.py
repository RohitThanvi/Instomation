"""DM auto-reply, end to end on real PostgreSQL + Redis: delivered DM -> moderation job -> reply job
-> outbound AI message + send job. Only the model's answers are scripted."""

import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import pytest
from arq.connections import ArqRedis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.core.retry import RetryPolicy
from app.models.base import utcnow
from app.models.business import AiSettings, BusinessProfile, KnowledgeEntry
from app.models.enums import (
    ConversationState,
    DeliveryStatus,
    KnowledgeKind,
    MessageDirection,
    MessageOrigin,
    ProcessingStatus,
)
from app.models.instagram import Conversation, Message
from app.models.ops import AiUsage, HumanHandoff, Job
from app.services.ai.gateway import AIGatewayError
from app.services.ai.provider import AICompletion, AIMessage
from app.services.instagram.crypto import TokenCipher
from app.workers.automation import generate_dm_reply
from app.workers.moderation import moderate_message
from app.workers.queues import QueueName
from app.workers.runtime import tracked
from tests.integration.test_conversations_flow import _deliver_inbound_message, _org_and_account

CLEAN = '{"category": "clean", "confidence": 0.95}'


def reply_json(reply: str, confidence: float = 0.9, needs_human: bool = False) -> str:
    import json

    return json.dumps({"reply": reply, "confidence": confidence, "needs_human": needs_human})


class SequenceGateway:
    """Returns scripted answers in order; an AIGatewayError in the script is raised instead."""

    def __init__(self, *answers: str | AIGatewayError, on_call: Any = None) -> None:
        self.answers = list(answers)
        self.calls: list[list[AIMessage]] = []
        self.on_call = on_call

    async def complete(
        self,
        messages: list[AIMessage],
        *,
        max_tokens: int,
        temperature: float = 0.4,
        organization_id: str | None = None,
    ) -> AICompletion:
        self.calls.append(messages)
        answer = self.answers.pop(0)
        if isinstance(answer, AIGatewayError):
            raise answer
        if self.on_call is not None:
            await self.on_call()
        return AICompletion(answer, "groq", "m", 30, 12, 7)


@dataclass
class Case:
    factory: async_sessionmaker[AsyncSession]
    pool: ArqRedis
    org_id: uuid.UUID
    account_id: uuid.UUID
    account_external_id: str
    sender: str
    settings_overrides: dict[str, Any] = field(default_factory=dict)

    def ctx(self, gateway: SequenceGateway) -> dict[str, Any]:
        return {
            "session_factory": self.factory,
            "settings": get_settings().model_copy(update=self.settings_overrides),
            "ai_gateway": gateway,
            "redis": self.pool,
            "retry_policy": RetryPolicy(3, 1.0, 8.0),
            "job_try": 1,
        }

    async def say(self, text: str, mid: str | None = None) -> None:
        await _deliver_inbound_message(
            self.factory,
            self.pool,
            self.org_id,
            self.account_id,
            self.account_external_id,
            self.sender,
            mid or f"mid-{uuid.uuid4().hex[:8]}",
            text,
        )

    async def jobs(self, kind: str) -> list[Job]:
        async with self.factory() as session:
            return list(
                (
                    await session.execute(
                        select(Job)
                        .where(Job.organization_id == self.org_id, Job.kind == kind)
                        .order_by(Job.created_at, Job.id)
                    )
                ).scalars()
            )

    async def run(self, function: Any, gateway: SequenceGateway, job: Job) -> None:
        await tracked(function)(self.ctx(gateway), str(job.id))

    async def reply_job_after_moderation(self, index: int = 0) -> Job:
        """Run the index-th moderation job as 'clean' and return the reply job it chained."""
        mod = (await self.jobs("moderate_message"))[index]
        await self.run(moderate_message, SequenceGateway(CLEAN), mod)
        chained = [
            j
            for j in await self.jobs("generate_dm_reply")
            if j.payload["message_id"] == mod.payload["message_id"]
        ]
        assert len(chained) == 1
        return chained[0]

    async def messages(self) -> list[Message]:
        async with self.factory() as session:
            return list(
                (
                    await session.execute(
                        select(Message)
                        .where(Message.organization_id == self.org_id)
                        .order_by(Message.created_at, Message.id)
                    )
                ).scalars()
            )

    async def outbound(self) -> list[Message]:
        return [m for m in await self.messages() if m.direction is MessageDirection.OUTBOUND]

    async def conversation(self) -> Conversation:
        async with self.factory() as session:
            return (
                await session.execute(
                    select(Conversation).where(Conversation.organization_id == self.org_id)
                )
            ).scalar_one()

    async def handoffs(self) -> list[HumanHandoff]:
        async with self.factory() as session:
            return list(
                (
                    await session.execute(
                        select(HumanHandoff).where(HumanHandoff.organization_id == self.org_id)
                    )
                ).scalars()
            )

    async def usage(self) -> list[AiUsage]:
        async with self.factory() as session:
            return list(
                (
                    await session.execute(
                        select(AiUsage).where(AiUsage.organization_id == self.org_id)
                    )
                ).scalars()
            )

    async def update_ai_settings(self, **values: Any) -> None:
        async with self.factory() as session:
            await session.execute(
                update(AiSettings).where(AiSettings.organization_id == self.org_id).values(**values)
            )
            await session.commit()


async def make_case(
    factory: async_sessionmaker[AsyncSession],
    pool: ArqRedis,
    cipher: TokenCipher,
    *,
    automation: bool = True,
) -> Case:
    _, org_id, account_id, external_id = await _org_and_account(factory, cipher)
    async with factory() as session:
        session.add(AiSettings(organization_id=org_id, dm_automation_enabled=automation))
        session.add(
            BusinessProfile(
                organization_id=org_id,
                brand_name="Cafe Aroma",
                website="https://cafe-aroma.test",
                description="Specialty coffee in Jaipur",
            )
        )
        session.add(
            KnowledgeEntry(
                organization_id=org_id,
                kind=KnowledgeKind.FAQ,
                title="Delivery",
                content="We deliver within Jaipur in 45 minutes. Order at https://cafe-aroma.test/order",
            )
        )
        await session.commit()
    return Case(factory, pool, org_id, account_id, external_id, f"cust-{uuid.uuid4().hex[:8]}")


@pytest.fixture
async def case(
    session_factory: async_sessionmaker[AsyncSession], pool: ArqRedis, cipher: TokenCipher
) -> Case:
    return await make_case(session_factory, pool, cipher)


# ---- the happy path, end to end ----
async def test_allowed_dm_is_answered_and_the_send_is_queued(case: Case) -> None:
    await case.say("Do you deliver in Jaipur? How long does delivery take?")
    reply_job = await case.reply_job_after_moderation()
    assert reply_job.queue == QueueName.AI.value
    gateway = SequenceGateway(reply_json("Yes! We deliver within Jaipur in about 45 minutes."))
    await case.run(generate_dm_reply, gateway, reply_job)

    (reply,) = await case.outbound()
    assert reply.origin is MessageOrigin.AI and reply.status is DeliveryStatus.PENDING
    assert reply.body == "Yes! We deliver within Jaipur in about 45 minutes."

    (send,) = await case.jobs("send_instagram_message")
    assert send.queue == QueueName.INSTAGRAM.value and send.status is ProcessingStatus.PENDING
    assert send.payload["message_id"] == str(reply.id)
    assert send.payload["recipient_external_id"] == case.sender
    queued = await case.pool.queued_jobs(queue_name=QueueName.INSTAGRAM.redis_key)
    assert [q.job_id for q in queued] == [str(send.id)]

    assert sorted(u.purpose for u in await case.usage()) == ["dm_reply", "moderation"]
    assert (await case.conversation()).state is ConversationState.AI_ACTIVE


async def test_prompt_carries_business_and_knowledge_and_ends_with_the_customer_turn(
    case: Case,
) -> None:
    await case.say("How long does delivery take?")
    job = await case.reply_job_after_moderation()
    gateway = SequenceGateway(reply_json("About 45 minutes."))
    await case.run(generate_dm_reply, gateway, job)
    system, *turns = gateway.calls[0]
    assert system.role == "system"
    assert "Cafe Aroma" in system.content and "45 minutes" in system.content
    assert [(t.role, t.content) for t in turns] == [("user", "How long does delivery take?")]


async def test_history_is_included_in_order_with_roles(case: Case) -> None:
    await case.say("Hi")
    first = await case.reply_job_after_moderation(0)
    await case.run(generate_dm_reply, SequenceGateway(reply_json("Hello! How can I help?")), first)
    await case.say("Do you deliver?")
    second = await case.reply_job_after_moderation(1)
    gateway = SequenceGateway(reply_json("Yes, within Jaipur."))
    await case.run(generate_dm_reply, gateway, second)
    turns = [(t.role, t.content) for t in gateway.calls[0][1:]]
    assert turns == [
        ("user", "Hi"),
        ("assistant", "Hello! How can I help?"),
        ("user", "Do you deliver?"),
    ]


async def test_a_follow_up_without_keywords_still_finds_the_knowledge(case: Case) -> None:
    await case.say("Do you deliver in Jaipur?")
    first = await case.reply_job_after_moderation(0)
    await case.run(generate_dm_reply, SequenceGateway(reply_json("Yes we do!")), first)
    await case.say("and how long does it take?")  # shares no word with the entry itself
    second = await case.reply_job_after_moderation(1)
    gateway = SequenceGateway(reply_json("About 45 minutes."))
    await case.run(generate_dm_reply, gateway, second)
    assert "45 minutes" in gateway.calls[0][0].content


async def test_knowledge_that_does_not_fit_the_budget_is_left_out_not_cut(case: Case) -> None:
    case.settings_overrides = {"dm_reply_knowledge_max_chars": 10}
    await case.say("Do you deliver in Jaipur?")
    job = await case.reply_job_after_moderation()
    gateway = SequenceGateway(reply_json("Yes."))
    await case.run(generate_dm_reply, gateway, job)
    system = gateway.calls[0][0].content
    assert '"knowledge": []' in system and "45 minutes" not in system


async def test_other_organizations_knowledge_never_reaches_the_prompt(
    case: Case,
    session_factory: async_sessionmaker[AsyncSession],
    pool: ArqRedis,
    cipher: TokenCipher,
) -> None:
    other = await make_case(session_factory, pool, cipher)
    async with session_factory() as session:
        session.add(
            KnowledgeEntry(
                organization_id=other.org_id,
                kind=KnowledgeKind.FAQ,
                title="Wholesale",
                content="Wholesale delivery price is 4 dollars per kilo SECRET-OTHER-TENANT",
            )
        )
        await session.commit()
    await case.say("delivery price wholesale")
    job = await case.reply_job_after_moderation()
    gateway = SequenceGateway(reply_json("We deliver within Jaipur."))
    await case.run(generate_dm_reply, gateway, job)
    assert "SECRET-OTHER-TENANT" not in gateway.calls[0][0].content


# ---- fail-closed: the model declines or answers doubtfully ----
@pytest.mark.parametrize(
    ("answer", "reason"),
    [
        (reply_json("", needs_human=True), "missing_information"),
        (reply_json("I think we deliver", confidence=0.4), "low_confidence"),
        (reply_json("   ", confidence=0.95), "low_confidence"),
        ("Sure, we deliver everywhere!", "low_confidence"),
        ('{"reply": "ok", "confidence": 0.9}', "low_confidence"),
        (reply_json("x" * 1001), "low_confidence"),
        (reply_json("ह" * 334), "low_confidence"),  # 1002 bytes in UTF-8
        (reply_json("Claim your prize at http://evil.test/win"), "low_confidence"),
    ],
)
async def test_doubtful_or_unsafe_output_goes_to_a_human_not_the_customer(
    case: Case, answer: str, reason: str
) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    await case.run(generate_dm_reply, SequenceGateway(answer), job)
    assert await case.outbound() == []
    assert await case.jobs("send_instagram_message") == []
    assert [h.reason.value for h in await case.handoffs()] == [reason]
    assert (await case.conversation()).state is ConversationState.HUMAN_REQUIRED
    assert "dm_reply" in [u.purpose for u in await case.usage()]  # the spend is still recorded


async def test_a_link_from_the_business_own_data_is_allowed(case: Case) -> None:
    await case.say("Where can I order?")
    job = await case.reply_job_after_moderation()
    await case.run(
        generate_dm_reply,
        SequenceGateway(reply_json("You can order at https://cafe-aroma.test/order.")),
        job,
    )
    (reply,) = await case.outbound()
    assert "https://cafe-aroma.test/order" in reply.body


async def test_exactly_at_the_byte_limit_is_sent(case: Case) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    await case.run(generate_dm_reply, SequenceGateway(reply_json("x" * 1000)), job)
    assert len(await case.outbound()) == 1


async def test_confidence_threshold_comes_from_the_organizations_settings(case: Case) -> None:
    await case.update_ai_settings(confidence_threshold=0.95)
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    await case.run(generate_dm_reply, SequenceGateway(reply_json("Yes", confidence=0.9)), job)
    assert await case.outbound() == []
    assert len(await case.handoffs()) == 1


# ---- preconditions ----
async def test_provider_outage_retries_and_sends_nothing(case: Case) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    with pytest.raises(Exception) as excinfo:  # arq Retry raised by tracked()
        await case.run(
            generate_dm_reply, SequenceGateway(AIGatewayError("down", retry_after=5)), job
        )
    assert type(excinfo.value).__name__ == "Retry"
    assert await case.outbound() == [] and await case.handoffs() == []
    assert (await case.conversation()).state is ConversationState.AI_ACTIVE


async def test_automation_switched_off_before_generation_means_no_model_call(case: Case) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    await case.update_ai_settings(dm_automation_enabled=False)
    gateway = SequenceGateway()
    await case.run(generate_dm_reply, gateway, job)
    assert gateway.calls == [] and await case.outbound() == []


async def test_a_human_who_took_over_in_the_meantime_is_not_talked_over(case: Case) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    async with case.factory() as session:
        conversation = await session.get(Conversation, (await case.conversation()).id)
        assert conversation is not None
        conversation.state = ConversationState.HUMAN_ACTIVE
        await session.commit()
    gateway = SequenceGateway()
    await case.run(generate_dm_reply, gateway, job)
    assert gateway.calls == [] and await case.outbound() == []


async def test_takeover_during_the_model_call_discards_the_reply(case: Case) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()

    async def human_takes_over() -> None:
        async with case.factory() as session:
            conversation = await session.get(Conversation, (await case.conversation()).id)
            assert conversation is not None
            conversation.state = ConversationState.HUMAN_ACTIVE
            await session.commit()

    gateway = SequenceGateway(reply_json("Yes we deliver"), on_call=human_takes_over)
    await case.run(generate_dm_reply, gateway, job)
    assert len(gateway.calls) == 1
    assert await case.outbound() == [] and await case.jobs("send_instagram_message") == []
    assert (await case.conversation()).state is ConversationState.HUMAN_ACTIVE
    assert "dm_reply" in [u.purpose for u in await case.usage()]


async def test_a_human_reply_already_sent_means_the_ai_stays_quiet(case: Case) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    async with case.factory() as session:
        conversation = await session.get(Conversation, (await case.conversation()).id)
        assert conversation is not None
        session.add(
            Message(
                organization_id=case.org_id,
                instagram_account_id=case.account_id,
                conversation_id=conversation.id,
                direction=MessageDirection.OUTBOUND,
                origin=MessageOrigin.HUMAN,
                body="Hi, owner here!",
                status=DeliveryStatus.SENT,
            )
        )
        await session.commit()
    gateway = SequenceGateway()
    await case.run(generate_dm_reply, gateway, job)
    assert gateway.calls == [] and len(await case.outbound()) == 1


async def test_rerunning_the_job_never_answers_twice(case: Case) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    gateway = SequenceGateway(reply_json("Yes"), reply_json("Yes again"))
    await case.run(generate_dm_reply, gateway, job)
    await case.run(generate_dm_reply, gateway, job)
    assert len(gateway.calls) == 1 and len(await case.outbound()) == 1


async def test_a_burst_of_messages_gets_one_reply_to_the_latest(case: Case) -> None:
    await case.say("Hi")
    await case.say("Do you deliver?")
    first = await case.reply_job_after_moderation(0)  # the newer message is not moderated yet
    gateway = SequenceGateway()
    await case.run(generate_dm_reply, gateway, first)
    assert gateway.calls == [] and await case.outbound() == []

    second = await case.reply_job_after_moderation(1)
    gateway = SequenceGateway(reply_json("Hello! Yes, we deliver."))
    await case.run(generate_dm_reply, gateway, second)
    assert [t.content for t in gateway.calls[0][1:]] == ["Hi", "Do you deliver?"]
    assert len(await case.outbound()) == 1


async def test_a_blocked_newer_message_does_not_steal_the_reply(case: Case) -> None:
    await case.say("Do you deliver?")
    await case.say("buy cheap followers http://a.test http://b.test http://c.test")
    first = await case.reply_job_after_moderation(0)
    second_mod = (await case.jobs("moderate_message"))[1]
    await case.run(moderate_message, SequenceGateway(), second_mod)  # rules block it, no model call
    gateway = SequenceGateway(reply_json("Yes, within Jaipur."))
    await case.run(generate_dm_reply, gateway, first)
    assert len(await case.outbound()) == 1
    assert [t.content for t in gateway.calls[0][1:]] == ["Do you deliver?"]  # spam not in context


async def test_earlier_blocked_messages_are_kept_out_of_the_prompt(case: Case) -> None:
    await case.say("buy cheap followers http://a.test http://b.test http://c.test")
    spam_mod = (await case.jobs("moderate_message"))[0]
    await case.run(moderate_message, SequenceGateway(), spam_mod)  # rules block it, no model call
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation(1)
    gateway = SequenceGateway(reply_json("Yes, within Jaipur."))
    await case.run(generate_dm_reply, gateway, job)
    assert [(t.role, t.content) for t in gateway.calls[0][1:]] == [("user", "Do you deliver?")]


async def test_the_hourly_reply_cap_stops_a_loop(case: Case) -> None:
    await case.update_ai_settings(max_replies_per_conversation_per_hour=1)
    await case.say("Hi")
    first = await case.reply_job_after_moderation(0)
    await case.run(generate_dm_reply, SequenceGateway(reply_json("Hello!")), first)
    await case.say("Hello?")
    second = await case.reply_job_after_moderation(1)
    gateway = SequenceGateway()
    await case.run(generate_dm_reply, gateway, second)
    assert gateway.calls == [] and len(await case.outbound()) == 1


async def test_a_message_older_than_the_messaging_window_is_not_answered(case: Case) -> None:
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    async with case.factory() as session:
        await session.execute(
            update(Message)
            .where(Message.organization_id == case.org_id)
            .values(created_at=utcnow() - timedelta(hours=25))
        )
        await session.commit()
    gateway = SequenceGateway()
    await case.run(generate_dm_reply, gateway, job)
    assert gateway.calls == [] and await case.outbound() == []


async def test_a_message_that_was_not_cleared_by_moderation_is_never_answered(case: Case) -> None:
    await case.say("Do you deliver?")
    job = (await case.jobs("moderate_message"))[0]
    # a reply job exists (e.g. forged or requeued) but the message was never moderated "allow"
    async with case.factory() as session:
        forged = Job(
            organization_id=case.org_id,
            queue=QueueName.AI.value,
            kind="generate_dm_reply",
            status=ProcessingStatus.PENDING,
            payload={"message_id": job.payload["message_id"]},
        )
        session.add(forged)
        await session.commit()
        await session.refresh(forged)
    gateway = SequenceGateway()
    await case.run(generate_dm_reply, gateway, forged)
    assert gateway.calls == [] and await case.outbound() == []


# ---- what moderation chains (and does not) ----
@pytest.mark.parametrize(
    ("verdict", "channel"),
    [
        ('{"category": "spam", "confidence": 0.9}', "dm"),
        ('{"category": "threat", "confidence": 0.9}', "dm"),
        ('{"category": "offensive", "confidence": 0.3}', "dm"),
        (CLEAN, "comment"),
    ],
)
async def test_only_a_clean_dm_chains_to_reply_generation(
    case: Case, verdict: str, channel: str
) -> None:
    await case.say("hello there")
    mod = (await case.jobs("moderate_message"))[0]
    async with case.factory() as session:
        await session.execute(
            update(Job).where(Job.id == mod.id).values(payload={**mod.payload, "channel": channel})
        )
        await session.commit()
    mod = (await case.jobs("moderate_message"))[0]  # re-read: payload now carries the channel
    await case.run(moderate_message, SequenceGateway(verdict), mod)
    assert await case.jobs("generate_dm_reply") == []


async def test_the_reply_job_is_queued_in_redis_after_moderation(case: Case) -> None:
    await case.say("hello there")
    reply_job = await case.reply_job_after_moderation()
    queued = await case.pool.queued_jobs(queue_name=QueueName.AI.redis_key)
    assert str(reply_job.id) in [q.job_id for q in queued]
