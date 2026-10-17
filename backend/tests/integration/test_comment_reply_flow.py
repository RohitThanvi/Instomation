"""Comment auto-reply, end to end on real PostgreSQL + Redis: delivered comment -> moderation ->
public reply generation -> send job -> Graph call. Only Meta and the model are faked."""

import uuid
from datetime import timedelta

import pytest
from arq import Retry
from arq.connections import ArqRedis
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.models.base import utcnow
from app.models.enums import (
    ConversationState,
    DeliveryStatus,
    MessageChannel,
    MessageDirection,
    ProcessingStatus,
)
from app.models.instagram import Conversation, Message, WebhookEvent
from app.models.ops import Job
from app.services.ai.gateway import AIGatewayError
from app.services.instagram.client import InstagramApiError
from app.services.instagram.crypto import TokenCipher
from app.workers.automation import escalate_unanswered, generate_comment_reply, generate_dm_reply
from app.workers.moderation import moderate_message
from app.workers.queue import give_up_sending, process_webhook_event, send_comment_reply
from app.workers.queues import QueueName
from app.workers.runtime import tracked
from tests.integration.test_conversations_flow import FakeInstagramApi
from tests.integration.test_dm_reply_flow import (
    CLEAN,
    Case,
    SequenceGateway,
    make_case,
    reply_json,
)

ASK = "Do you deliver in Jaipur?"


@pytest.fixture
async def case(
    session_factory: async_sessionmaker[AsyncSession], pool: ArqRedis, cipher: TokenCipher
) -> Case:
    made = await make_case(session_factory, pool, cipher)
    await made.update_ai_settings(comment_automation_enabled=True)
    return made


@pytest.fixture
def api() -> FakeInstagramApi:
    return FakeInstagramApi()


async def comment(case: Case, text: str = ASK, comment_id: str | None = None) -> str:
    """Deliver a comment webhook event through the real events handler; returns the comment id."""
    comment_id = comment_id or f"c{uuid.uuid4().hex[:10]}"
    async with case.factory() as session:
        result = await session.execute(
            insert(WebhookEvent)
            .values(
                organization_id=case.org_id,
                instagram_account_id=case.account_id,
                external_event_id=f"comment:{comment_id}",
                event_type="comments",
                payload_hash="h",
                payload_json={
                    "id": comment_id,
                    "text": text,
                    "from": {"id": case.sender, "username": "fan"},
                },
                status=ProcessingStatus.PENDING,
            )
            .returning(WebhookEvent.id)
        )
        event_id = result.scalar_one()
        job = Job(
            organization_id=case.org_id,
            queue="events",
            kind="process_webhook_event",
            status=ProcessingStatus.PENDING,
            payload={"webhook_event_id": str(event_id)},
        )
        session.add(job)
        await session.commit()
        job_id = job.id
    await tracked(process_webhook_event)(case.ctx(SequenceGateway()), str(job_id))
    return comment_id


async def moderated_reply_job(case: Case, index: int = 0, verdict: str = CLEAN) -> Job | None:
    """Run the index-th moderation job; return the reply job it chained (if any)."""
    mod = (await case.jobs("moderate_message"))[index]
    await case.run(moderate_message, SequenceGateway(verdict), mod)
    chained = [
        j
        for j in await case.jobs("generate_comment_reply")
        if j.payload["message_id"] == mod.payload["message_id"]
    ]
    assert len(chained) <= 1
    return chained[0] if chained else None


async def answered_comment(
    case: Case, text: str = ASK, reply: str = "Yes, within Jaipur!"
) -> tuple[str, Message, Job]:
    comment_id = await comment(case, text)
    job = await moderated_reply_job(case)
    assert job is not None
    await case.run(generate_comment_reply, SequenceGateway(reply_json(reply)), job)
    (message,) = await case.outbound()
    (send,) = await case.jobs("send_comment_reply")
    return comment_id, message, send


# ---- happy path ----
async def test_allowed_comment_gets_a_public_reply_queued_and_posted(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    comment_id, reply, send = await answered_comment(case)
    assert reply.status is DeliveryStatus.PENDING and reply.body == "Yes, within Jaipur!"
    # The customer's comment and our public answer both belong to the public comment thread.
    inbound = [m for m in await case.messages() if m.direction is MessageDirection.INBOUND]
    assert [m.channel for m in inbound] == [MessageChannel.COMMENT]
    assert reply.channel is MessageChannel.COMMENT
    assert send.queue == QueueName.INSTAGRAM.value
    assert send.payload["comment_id"] == comment_id  # Instagram's id, without our storage prefix
    queued = await case.pool.queued_jobs(queue_name=QueueName.INSTAGRAM.redis_key)
    assert [q.job_id for q in queued] == [str(send.id)]
    assert sorted(u.purpose for u in await case.usage()) == ["comment_reply", "moderation"]

    ctx = case.ctx(SequenceGateway()) | {"instagram_api": api, "token_cipher": cipher}
    await tracked(send_comment_reply, on_exhausted=give_up_sending)(ctx, str(send.id))
    assert api.replies == [(comment_id, "Yes, within Jaipur!")] and api.sent == []
    async with case.factory() as session:
        sent = await session.get(Message, reply.id)
        assert sent is not None and sent.status is DeliveryStatus.SENT
        assert sent.external_message_id == "reply-1"


async def test_prompt_is_public_and_carries_only_the_comment(case: Case) -> None:
    await comment(case, "How long does delivery take?")
    job = await moderated_reply_job(case)
    assert job is not None
    gateway = SequenceGateway(reply_json("About 45 minutes."))
    await case.run(generate_comment_reply, gateway, job)
    system, *turns = gateway.calls[0]
    assert "PUBLIC reply" in system.content and "under 300 characters" in system.content
    assert "45 minutes" in system.content and "Cafe Aroma" in system.content
    assert [(t.role, t.content) for t in turns] == [("user", "How long does delivery take?")]


async def test_each_comment_is_answered_separately(case: Case) -> None:
    first_id = await comment(case, "Do you deliver?")
    second_id = await comment(case, "What are your hours?")
    for index in (0, 1):
        job = await moderated_reply_job(case, index)
        assert job is not None
        await case.run(generate_comment_reply, SequenceGateway(reply_json(f"answer {index}")), job)
    sends = await case.jobs("send_comment_reply")
    assert sorted(s.payload["comment_id"] for s in sends) == sorted([first_id, second_id])
    assert len(await case.outbound()) == 2


# ---- fail closed ----
@pytest.mark.parametrize(
    ("answer", "reason"),
    [
        (reply_json("", needs_human=True), "missing_information"),
        (reply_json("maybe", confidence=0.3), "low_confidence"),
        ("Sure thing!", "low_confidence"),
        (reply_json("x" * 301), "low_confidence"),
        (reply_json("Win a prize: http://evil.test/x"), "low_confidence"),
    ],
)
async def test_doubtful_or_unsafe_output_posts_nothing_and_asks_a_human(
    case: Case, answer: str, reason: str
) -> None:
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    await case.run(generate_comment_reply, SequenceGateway(answer), job)
    assert await case.outbound() == [] and await case.jobs("send_comment_reply") == []
    assert [h.reason.value for h in await case.handoffs()] == [reason]


async def test_length_limit_counts_characters_not_bytes_and_is_inclusive(case: Case) -> None:
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    await case.run(generate_comment_reply, SequenceGateway(reply_json("ह" * 300)), job)
    (reply,) = await case.outbound()  # 900 bytes, but exactly 300 characters
    assert len(reply.body) == 300


async def test_a_link_from_the_business_own_data_is_allowed(case: Case) -> None:
    await comment(case, "Where can I order?")
    job = await moderated_reply_job(case)
    assert job is not None
    await case.run(
        generate_comment_reply,
        SequenceGateway(reply_json("Order here: https://cafe-aroma.test/order")),
        job,
    )
    assert len(await case.outbound()) == 1


# ---- gating ----
async def test_comment_automation_and_dm_automation_are_independent_switches(
    case: Case,
) -> None:
    await case.update_ai_settings(comment_automation_enabled=False, dm_automation_enabled=True)
    await comment(case)
    assert await case.jobs("moderate_message") == []  # DM automation does not cover comments
    await case.update_ai_settings(comment_automation_enabled=True, dm_automation_enabled=False)
    await comment(case)
    assert len(await case.jobs("moderate_message")) == 1  # and vice versa


@pytest.mark.parametrize(
    "verdict",
    [
        '{"category": "spam", "confidence": 0.9}',
        '{"category": "sexual", "confidence": 0.9}',
        '{"category": "offensive", "confidence": 0.9}',
    ],
)
async def test_blocked_comments_are_not_answered(case: Case, verdict: str) -> None:
    await comment(case)
    assert await moderated_reply_job(case, 0, verdict) is None
    assert await case.outbound() == [] and await case.handoffs() == []


async def test_a_threatening_comment_goes_to_a_human_not_the_ai(case: Case) -> None:
    await comment(case, "I will hurt you")
    assert await moderated_reply_job(case, 0, '{"category": "threat", "confidence": 0.9}') is None
    assert [h.reason.value for h in await case.handoffs()] == ["threat"]


async def test_automation_switched_off_before_generation_means_no_model_call(case: Case) -> None:
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    await case.update_ai_settings(comment_automation_enabled=False)
    gateway = SequenceGateway()
    await case.run(generate_comment_reply, gateway, job)
    assert gateway.calls == [] and await case.outbound() == []


async def test_a_person_handling_the_customer_is_not_talked_over(case: Case) -> None:
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    async with case.factory() as session:
        await session.execute(
            update(Conversation)
            .where(Conversation.organization_id == case.org_id)
            .values(state=ConversationState.HUMAN_ACTIVE)
        )
        await session.commit()
    gateway = SequenceGateway()
    await case.run(generate_comment_reply, gateway, job)
    assert gateway.calls == [] and await case.outbound() == []


async def test_takeover_during_the_model_call_discards_the_reply(case: Case) -> None:
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None

    async def human_takes_over() -> None:
        async with case.factory() as session:
            await session.execute(
                update(Conversation)
                .where(Conversation.organization_id == case.org_id)
                .values(state=ConversationState.HUMAN_ACTIVE)
            )
            await session.commit()

    gateway = SequenceGateway(reply_json("Yes!"), on_call=human_takes_over)
    await case.run(generate_comment_reply, gateway, job)
    assert len(gateway.calls) == 1
    assert await case.outbound() == [] and await case.jobs("send_comment_reply") == []


async def duplicate_of(case: Case, job: Job) -> Job:
    """A second jobs row for the same work (a duplicate enqueue): `tracked` only skips a row that
    is already DONE, so the generator itself must refuse to answer twice."""
    async with case.factory() as session:
        twin = Job(
            organization_id=case.org_id,
            queue=job.queue,
            kind=job.kind,
            status=ProcessingStatus.PENDING,
            payload=dict(job.payload),
        )
        session.add(twin)
        await session.commit()
        await session.refresh(twin)
        return twin


async def test_a_duplicate_job_never_replies_twice(case: Case) -> None:
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    gateway = SequenceGateway(reply_json("Yes"), reply_json("Yes again"))
    await case.run(generate_comment_reply, gateway, job)
    await case.run(generate_comment_reply, gateway, job)  # same row: tracked() skips it
    await case.run(generate_comment_reply, gateway, await duplicate_of(case, job))
    assert len(gateway.calls) == 1 and len(await case.outbound()) == 1
    assert len(await case.jobs("send_comment_reply")) == 1


async def test_a_stale_comment_is_not_answered(case: Case) -> None:
    window_hours = get_settings().comment_reply_window_hours
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    async with case.factory() as session:
        await session.execute(
            update(Message)
            .where(Message.organization_id == case.org_id)
            .values(created_at=utcnow() - timedelta(hours=window_hours + 1))
        )
        await session.commit()
    gateway = SequenceGateway()
    await case.run(generate_comment_reply, gateway, job)
    assert gateway.calls == [] and await case.outbound() == []


async def test_the_hourly_cap_applies_to_comment_replies(case: Case) -> None:
    await case.update_ai_settings(max_replies_per_conversation_per_hour=1)
    await comment(case, "first")
    await comment(case, "second")
    first = await moderated_reply_job(case, 0)
    assert first is not None
    await case.run(generate_comment_reply, SequenceGateway(reply_json("one")), first)
    second = await moderated_reply_job(case, 1)
    assert second is not None
    gateway = SequenceGateway()
    await case.run(generate_comment_reply, gateway, second)
    assert gateway.calls == [] and len(await case.outbound()) == 1


async def test_unmoderated_comment_is_never_answered(case: Case) -> None:
    await comment(case)
    mod = (await case.jobs("moderate_message"))[0]
    async with case.factory() as session:
        forged = Job(
            organization_id=case.org_id,
            queue=QueueName.AI.value,
            kind="generate_comment_reply",
            status=ProcessingStatus.PENDING,
            payload={"message_id": mod.payload["message_id"]},
        )
        session.add(forged)
        await session.commit()
        await session.refresh(forged)
    gateway = SequenceGateway()
    await case.run(generate_comment_reply, gateway, forged)
    assert gateway.calls == [] and await case.outbound() == []


# ---- comment and DM paths never cross ----
async def test_a_dm_is_never_answered_by_the_comment_generator(case: Case) -> None:
    await case.update_ai_settings(dm_automation_enabled=True)
    await case.say("Do you deliver?")
    mod = (await case.jobs("moderate_message"))[0]
    await case.run(moderate_message, SequenceGateway(CLEAN), mod)
    forged = Job(
        organization_id=case.org_id,
        queue=QueueName.AI.value,
        kind="generate_comment_reply",
        status=ProcessingStatus.PENDING,
        payload={"message_id": mod.payload["message_id"]},
    )
    async with case.factory() as session:
        session.add(forged)
        await session.commit()
        await session.refresh(forged)
    gateway = SequenceGateway()
    await case.run(generate_comment_reply, gateway, forged)
    assert gateway.calls == [] and await case.outbound() == []


async def test_a_comment_is_never_answered_by_dm(case: Case) -> None:
    await case.update_ai_settings(dm_automation_enabled=True)
    await comment(case)
    mod = (await case.jobs("moderate_message"))[0]
    await case.run(moderate_message, SequenceGateway(CLEAN), mod)
    forged = Job(
        organization_id=case.org_id,
        queue=QueueName.AI.value,
        kind="generate_dm_reply",
        status=ProcessingStatus.PENDING,
        payload={"message_id": mod.payload["message_id"]},
    )
    async with case.factory() as session:
        session.add(forged)
        await session.commit()
        await session.refresh(forged)
    gateway = SequenceGateway()
    await case.run(generate_dm_reply, gateway, forged)
    assert gateway.calls == [] and await case.jobs("send_instagram_message") == []


async def test_a_clean_dm_still_chains_to_the_dm_generator_only(case: Case) -> None:
    await case.update_ai_settings(dm_automation_enabled=True)
    await case.say("Do you deliver?")
    job = await case.reply_job_after_moderation()
    assert job.kind == "generate_dm_reply"
    assert await case.jobs("generate_comment_reply") == []


# ---- delivery ----
async def test_a_failed_public_reply_asks_a_human(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    _, reply, send = await answered_comment(case)
    api.fail_with = InstagramApiError("bad", status_code=400, code=100)
    ctx = case.ctx(SequenceGateway()) | {"instagram_api": api, "token_cipher": cipher}
    await tracked(send_comment_reply, on_exhausted=give_up_sending)(ctx, str(send.id))
    async with case.factory() as session:
        failed = await session.get(Message, reply.id)
        assert failed is not None and failed.status is DeliveryStatus.FAILED
    assert [h.reason.value for h in await case.handoffs()] == ["manual"]


async def test_transient_failure_retries_then_escalates_when_exhausted(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    _, reply, send = await answered_comment(case)
    api.fail_with = InstagramApiError("unavailable", status_code=503)
    ctx = case.ctx(SequenceGateway()) | {"instagram_api": api, "token_cipher": cipher}
    wrapped = tracked(send_comment_reply, on_exhausted=give_up_sending)
    with pytest.raises(Retry):
        await wrapped(ctx | {"job_try": 1}, str(send.id))
    assert await case.handoffs() == []
    await wrapped(ctx | {"job_try": 3}, str(send.id))
    assert [h.reason.value for h in await case.handoffs()] == ["manual"]


async def test_the_comment_reply_capability_can_be_switched_off(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    _, reply, send = await answered_comment(case)
    case.settings_overrides = {"feature_comment_reply": False}
    ctx = case.ctx(SequenceGateway()) | {"instagram_api": api, "token_cipher": cipher}
    await tracked(send_comment_reply)(ctx, str(send.id))
    assert api.replies == []
    async with case.factory() as session:
        suppressed = await session.get(Message, reply.id)
        assert suppressed is not None and suppressed.status is DeliveryStatus.SUPPRESSED


async def test_provider_outage_exhausting_retries_asks_a_human(case: Case) -> None:
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    ctx = case.ctx(SequenceGateway(AIGatewayError("down"))) | {"job_try": 3}
    await tracked(generate_comment_reply, on_exhausted=escalate_unanswered)(ctx, str(job.id))
    assert await case.outbound() == []
    assert [h.reason.value for h in await case.handoffs()] == ["low_confidence"]


async def test_comments_and_dms_do_not_count_each_others_messages_as_answers(case: Case) -> None:
    await case.update_ai_settings(dm_automation_enabled=True)
    await case.say("Hello")
    dm_job = await case.reply_job_after_moderation(0)
    await case.run(generate_dm_reply, SequenceGateway(reply_json("Hi there!")), dm_job)
    await comment(case)  # arrives after an AI DM reply: must still be answered
    comment_job = await moderated_reply_job(case, 1)
    assert comment_job is not None
    gateway = SequenceGateway(reply_json("Yes we deliver."))
    await case.run(generate_comment_reply, gateway, comment_job)
    assert len(gateway.calls) == 1
    assert [m.direction for m in await case.messages()].count(MessageDirection.OUTBOUND) == 2
