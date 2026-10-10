"""When automation gives up on a customer, a human is asked: failed or exhausted sends, and AI
jobs whose provider stayed down. Real PostgreSQL + Redis; only Meta and the model are faked."""

import uuid
from typing import Any

import pytest
from arq import Retry
from arq.connections import ArqRedis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.enums import (
    ConversationState,
    DeliveryStatus,
    InstagramAccountStatus,
    MessageDirection,
    MessageOrigin,
    ProcessingStatus,
)
from app.models.instagram import Conversation, InstagramAccount, Message
from app.models.ops import Job
from app.services.ai.gateway import AIGatewayError
from app.services.instagram.client import InstagramApiError
from app.services.instagram.crypto import TokenCipher
from app.workers.automation import escalate_unanswered, generate_dm_reply
from app.workers.moderation import moderate_message
from app.workers.queue import give_up_sending, send_instagram_message
from app.workers.queues import QueueName
from app.workers.runtime import tracked
from tests.integration.test_conversations_flow import FakeInstagramApi
from tests.integration.test_dm_reply_flow import Case, SequenceGateway, make_case, reply_json


@pytest.fixture
async def case(
    session_factory: async_sessionmaker[AsyncSession], pool: ArqRedis, cipher: TokenCipher
) -> Case:
    return await make_case(session_factory, pool, cipher)


@pytest.fixture
def api() -> FakeInstagramApi:
    return FakeInstagramApi()


async def _queued_ai_reply(case: Case) -> tuple[Message, Job]:
    """Run a DM through moderation and reply generation; return the AI message and its send job."""
    await case.say("Do you deliver in Jaipur?")
    reply_job = await case.reply_job_after_moderation()
    await case.run(generate_dm_reply, SequenceGateway(reply_json("Yes, within Jaipur.")), reply_job)
    (message,) = await case.outbound()
    (send_job,) = await case.jobs("send_instagram_message")
    return message, send_job


async def _send(
    case: Case,
    api: FakeInstagramApi,
    cipher: TokenCipher,
    job: Job,
    *,
    attempt: int = 1,
) -> None:
    ctx: dict[str, Any] = case.ctx(SequenceGateway()) | {
        "instagram_api": api,
        "token_cipher": cipher,
        "job_try": attempt,
    }
    wrapped = tracked(send_instagram_message, on_exhausted=give_up_sending)
    await wrapped(ctx, str(job.id))


async def _status(case: Case, message_id: uuid.UUID) -> DeliveryStatus:
    async with case.factory() as session:
        message = await session.get(Message, message_id)
        assert message is not None
        return message.status


async def _job_status(case: Case, job_id: uuid.UUID) -> ProcessingStatus:
    async with case.factory() as session:
        job = await session.get(Job, job_id)
        assert job is not None
        return job.status


async def _assert_human_asked(case: Case, reason: str) -> None:
    assert [h.reason.value for h in await case.handoffs()] == [reason]
    assert (await case.conversation()).state is ConversationState.HUMAN_REQUIRED


# ---- a failed send of an AI reply reaches a human ----
@pytest.mark.parametrize(
    "error",
    [
        InstagramApiError("bad request", status_code=400, code=100),
        InstagramApiError("forbidden", status_code=403),
    ],
)
async def test_permanent_send_failure_fails_the_message_and_asks_a_human(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher, error: InstagramApiError
) -> None:
    message, job = await _queued_ai_reply(case)
    api.fail_with = error
    await _send(case, api, cipher, job)
    assert await _status(case, message.id) is DeliveryStatus.FAILED
    await _assert_human_asked(case, "manual")
    assert await _job_status(case, job.id) is ProcessingStatus.DONE  # the handler finished cleanly


async def test_expired_token_marks_the_account_and_asks_a_human(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _queued_ai_reply(case)
    api.fail_with = InstagramApiError("expired", status_code=401)
    await _send(case, api, cipher, job)
    assert await _status(case, message.id) is DeliveryStatus.FAILED
    async with case.factory() as session:
        account = await session.get(InstagramAccount, case.account_id)
        assert account is not None and account.status is InstagramAccountStatus.TOKEN_EXPIRED
    await _assert_human_asked(case, "manual")


async def test_inactive_account_fails_the_message_and_asks_a_human(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _queued_ai_reply(case)
    async with case.factory() as session:
        await session.execute(
            update(InstagramAccount)
            .where(InstagramAccount.id == case.account_id)
            .values(status=InstagramAccountStatus.TOKEN_EXPIRED)
        )
        await session.commit()
    await _send(case, api, cipher, job)
    assert api.sent == [] and await _status(case, message.id) is DeliveryStatus.FAILED
    await _assert_human_asked(case, "manual")


async def test_an_undecryptable_token_fails_the_message_and_asks_a_human(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _queued_ai_reply(case)
    async with case.factory() as session:
        await session.execute(
            update(InstagramAccount)
            .where(InstagramAccount.id == case.account_id)
            .values(access_token_encrypted=b"not-a-valid-ciphertext")
        )
        await session.commit()
    await _send(case, api, cipher, job)
    assert api.sent == [] and await _status(case, message.id) is DeliveryStatus.FAILED
    await _assert_human_asked(case, "manual")


# ---- transient failures: retried, and escalated only when retries run out ----
TRANSIENT = InstagramApiError("unavailable", status_code=503)


async def test_transient_failure_with_attempts_left_is_retried_not_escalated(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _queued_ai_reply(case)
    api.fail_with = TRANSIENT
    with pytest.raises(Retry):
        await _send(case, api, cipher, job, attempt=1)
    assert await _status(case, message.id) is DeliveryStatus.PENDING
    assert await case.handoffs() == []
    assert await _job_status(case, job.id) is ProcessingStatus.PENDING


async def test_exhausted_retries_fail_the_message_and_ask_a_human(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _queued_ai_reply(case)
    api.fail_with = TRANSIENT
    await _send(case, api, cipher, job, attempt=3)  # RetryPolicy(3, ...): the last attempt
    assert await _status(case, message.id) is DeliveryStatus.FAILED
    await _assert_human_asked(case, "manual")
    assert await _job_status(case, job.id) is ProcessingStatus.FAILED


async def test_a_message_that_was_sent_meanwhile_is_not_failed_by_the_give_up_hook(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _queued_ai_reply(case)
    async with case.factory() as session:
        await session.execute(
            update(Message).where(Message.id == message.id).values(status=DeliveryStatus.SENT)
        )
        await session.commit()
    ctx = case.ctx(SequenceGateway())
    await give_up_sending(ctx, {"message_id": str(message.id)})
    assert await _status(case, message.id) is DeliveryStatus.SENT
    assert await case.handoffs() == []


# ---- who gets escalated ----
async def _human_message_and_job(case: Case) -> tuple[Message, Job]:
    await case.say("hello")
    async with case.factory() as session:
        conversation = (
            await session.execute(
                select(Conversation).where(Conversation.organization_id == case.org_id)
            )
        ).scalar_one()
        message = Message(
            organization_id=case.org_id,
            instagram_account_id=case.account_id,
            conversation_id=conversation.id,
            direction=MessageDirection.OUTBOUND,
            origin=MessageOrigin.HUMAN,
            body="Owner here",
            status=DeliveryStatus.PENDING,
        )
        session.add(message)
        await session.flush()
        job = Job(
            organization_id=case.org_id,
            queue=QueueName.INSTAGRAM.value,
            kind="send_instagram_message",
            status=ProcessingStatus.PENDING,
            payload={
                "message_id": str(message.id),
                "instagram_account_id": str(case.account_id),
                "recipient_external_id": case.sender,
            },
        )
        session.add(job)
        await session.commit()
        return message, job


async def test_a_failed_human_message_does_not_raise_another_handoff(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _human_message_and_job(case)
    api.fail_with = InstagramApiError("bad", status_code=400, code=100)
    await _send(case, api, cipher, job)
    assert await _status(case, message.id) is DeliveryStatus.FAILED
    assert await case.handoffs() == []
    assert (await case.conversation()).state is ConversationState.AI_ACTIVE


async def test_no_second_handoff_when_a_human_already_owns_the_conversation(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _queued_ai_reply(case)
    async with case.factory() as session:
        await session.execute(
            update(Conversation)
            .where(Conversation.organization_id == case.org_id)
            .values(state=ConversationState.HUMAN_ACTIVE)
        )
        await session.commit()
    api.fail_with = InstagramApiError("bad", status_code=400, code=100)
    await _send(case, api, cipher, job)
    assert await _status(case, message.id) is DeliveryStatus.FAILED
    assert await case.handoffs() == []
    assert (await case.conversation()).state is ConversationState.HUMAN_ACTIVE


async def test_a_successful_send_raises_no_handoff(
    case: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    message, job = await _queued_ai_reply(case)
    await _send(case, api, cipher, job)
    assert await _status(case, message.id) is DeliveryStatus.SENT
    assert await case.handoffs() == []


# ---- AI jobs that exhaust their retries ----
async def test_reply_generation_that_exhausts_retries_asks_a_human(case: Case) -> None:
    await case.say("Do you deliver in Jaipur?")
    job = await case.reply_job_after_moderation()
    ctx = case.ctx(SequenceGateway(AIGatewayError("down"))) | {"job_try": 3}
    await tracked(generate_dm_reply, on_exhausted=escalate_unanswered)(ctx, str(job.id))
    assert await case.outbound() == []
    await _assert_human_asked(case, "low_confidence")
    assert await _job_status(case, job.id) is ProcessingStatus.FAILED


async def test_moderation_that_exhausts_retries_asks_a_human(case: Case) -> None:
    await case.say("hello")
    (job,) = await case.jobs("moderate_message")
    ctx = case.ctx(SequenceGateway(AIGatewayError("down"))) | {"job_try": 3}
    await tracked(moderate_message, on_exhausted=escalate_unanswered)(ctx, str(job.id))
    await _assert_human_asked(case, "low_confidence")
    assert (await case.messages())[0].moderation is None  # never judged safe


async def test_an_ai_job_with_attempts_left_does_not_escalate(case: Case) -> None:
    await case.say("hello")
    (job,) = await case.jobs("moderate_message")
    ctx = case.ctx(SequenceGateway(AIGatewayError("down"))) | {"job_try": 1}
    with pytest.raises(Retry):
        await tracked(moderate_message, on_exhausted=escalate_unanswered)(ctx, str(job.id))
    assert await case.handoffs() == []


async def test_a_crashing_give_up_hook_does_not_break_the_job_wrapper(case: Case) -> None:
    await case.say("hello")
    (job,) = await case.jobs("moderate_message")

    async def broken(ctx: dict[str, Any], payload: dict[str, Any]) -> None:
        raise RuntimeError("hook bug")

    ctx = case.ctx(SequenceGateway(AIGatewayError("down"))) | {"job_try": 3}
    await tracked(moderate_message, on_exhausted=broken)(ctx, str(job.id))  # must not raise
    assert await _job_status(case, job.id) is ProcessingStatus.FAILED
