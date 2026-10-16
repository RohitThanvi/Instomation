"""Private replies to commenters, end to end on real PostgreSQL + Redis: comment -> moderation ->
one model call -> public reply AND private message queued -> both delivered through Meta's two
different endpoints. Only Meta and the model are faked.

Meta's rules these tests encode (developers.facebook.com/docs/instagram-platform/private-replies):
one private message per comment, sent within 7 days, as a single message of at most 1000 bytes.
"""

import json
from typing import Any

import pytest
from arq import Retry
from arq.connections import ArqRedis
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.enums import ConversationState, DeliveryStatus
from app.models.instagram import Conversation, Message
from app.services.instagram.client import InstagramApiError
from app.services.instagram.crypto import TokenCipher
from app.workers.automation import generate_comment_reply
from app.workers.moderation import moderate_message
from app.workers.queue import give_up_sending, send_comment_reply, send_private_reply
from app.workers.queues import QueueName
from app.workers.runtime import tracked
from tests.integration.test_comment_reply_flow import comment, duplicate_of, moderated_reply_job
from tests.integration.test_conversations_flow import FakeInstagramApi
from tests.integration.test_dm_reply_flow import (
    CLEAN,
    Case,
    SequenceGateway,
    make_case,
    reply_json,
)

PUBLIC = "Sent you the details in a message!"
PRIVATE = "Delivery is free in Jaipur, 30 to 45 minutes. Order: https://cafe-aroma.test/order"


def with_private(
    reply: str = PUBLIC,
    private: str = PRIVATE,
    confidence: float = 0.9,
    needs_human: bool = False,
) -> str:
    return json.dumps(
        {
            "reply": reply,
            "private_reply": private,
            "confidence": confidence,
            "needs_human": needs_human,
        }
    )


@pytest.fixture
async def case(
    session_factory: async_sessionmaker[AsyncSession], pool: ArqRedis, cipher: TokenCipher
) -> Case:
    """Comment automation on; private replies left at their default (off)."""
    made = await make_case(session_factory, pool, cipher)
    await made.update_ai_settings(comment_automation_enabled=True)
    return made


@pytest.fixture
def api() -> FakeInstagramApi:
    return FakeInstagramApi()


@pytest.fixture
async def enabled(case: Case) -> Case:
    await case.update_ai_settings(private_reply_enabled=True)
    return case


async def generate(case: Case, answer: str) -> SequenceGateway:
    await comment(case)
    job = await moderated_reply_job(case)
    assert job is not None
    gateway = SequenceGateway(answer)
    await case.run(generate_comment_reply, gateway, job)
    return gateway


def deliver_ctx(case: Case, api: FakeInstagramApi, cipher: TokenCipher) -> dict[str, Any]:
    return case.ctx(SequenceGateway()) | {"instagram_api": api, "token_cipher": cipher}


# ---- the happy path ----
async def test_a_comment_gets_a_public_reply_and_a_private_message_delivered_separately(
    enabled: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    case = enabled
    await generate(case, with_private())

    public, private = await case.outbound()
    assert (public.body, private.body) == (PUBLIC, PRIVATE)
    assert public.status is private.status is DeliveryStatus.PENDING
    (public_job,) = await case.jobs("send_comment_reply")
    (private_job,) = await case.jobs("send_private_reply")
    assert public_job.queue == private_job.queue == QueueName.INSTAGRAM.value
    # Both answer the same comment, which is what makes "once per comment" enforceable.
    assert public_job.payload["comment_message_id"] == private_job.payload["comment_message_id"]
    assert public_job.payload["comment_id"] == private_job.payload["comment_id"]
    assert private_job.payload["message_id"] == str(private.id)
    queued = await case.pool.queued_jobs(queue_name=QueueName.INSTAGRAM.redis_key)
    assert sorted(q.job_id for q in queued) == sorted([str(public_job.id), str(private_job.id)])
    # One model call made both texts.
    assert [u.purpose for u in await case.usage() if u.purpose == "comment_reply"] == [
        "comment_reply"
    ]

    ctx = deliver_ctx(case, api, cipher)
    await tracked(send_comment_reply, on_exhausted=give_up_sending)(ctx, str(public_job.id))
    await tracked(send_private_reply, on_exhausted=give_up_sending)(ctx, str(private_job.id))
    comment_id = public_job.payload["comment_id"]
    assert api.replies == [(comment_id, PUBLIC)]
    assert api.private_replies == [(case.account_external_id, comment_id, PRIVATE)]
    assert api.sent == []  # a private reply is not an ordinary DM to a known recipient
    async with case.factory() as session:
        for sent in (public, private):
            stored = await session.get(Message, sent.id)
            assert stored is not None and stored.status is DeliveryStatus.SENT
            assert stored.external_message_id is not None
        stored_private = await session.get(Message, private.id)
        assert stored_private is not None and stored_private.external_message_id == "private-1"


# ---- when it is not offered, nothing changes ----
async def test_the_model_is_only_asked_for_a_private_message_when_the_owner_allowed_it(
    case: Case,
) -> None:
    gateway = await generate(case, reply_json(PUBLIC))
    system = gateway.calls[0][0].content
    assert "private_reply" not in system and "PUBLIC reply" in system


async def test_when_allowed_the_prompt_asks_for_one_complete_message_within_the_dm_limit(
    enabled: Case,
) -> None:
    gateway = await generate(enabled, with_private())
    system = gateway.calls[0][0].content
    assert '"private_reply"' in system and "under 250 characters" in system
    assert "the only message they will receive" in system
    assert "under 300 characters" in system  # the public reply keeps its own, shorter limit


async def test_a_private_text_the_model_writes_anyway_is_never_sent_when_off(
    case: Case,
) -> None:
    await generate(case, with_private())
    (only,) = await case.outbound()
    assert only.body == PUBLIC
    assert await case.jobs("send_private_reply") == []


async def test_the_capability_switch_turns_the_whole_feature_off_even_when_the_owner_allowed_it(
    enabled: Case,
) -> None:
    enabled.settings_overrides = {"feature_private_reply": False}
    gateway = await generate(enabled, with_private())
    assert "private_reply" not in gateway.calls[0][0].content
    assert [m.body for m in await enabled.outbound()] == [PUBLIC]
    assert await enabled.jobs("send_private_reply") == []


@pytest.mark.parametrize("private", ["", "   \n "])
async def test_a_public_reply_alone_is_fine_when_the_model_has_nothing_to_add_privately(
    enabled: Case, private: str
) -> None:
    await generate(enabled, with_private(private=private))
    assert [m.body for m in await enabled.outbound()] == [PUBLIC]
    assert await enabled.jobs("send_private_reply") == []


async def test_an_answer_without_the_private_field_still_works_when_allowed(
    enabled: Case,
) -> None:
    await generate(enabled, reply_json(PUBLIC))
    assert [m.body for m in await enabled.outbound()] == [PUBLIC]


# ---- fail closed: a half-sent answer is worse than a handoff ----
@pytest.mark.parametrize(
    ("answer", "why"),
    [
        (with_private(private="x" * 1001), "private text over Instagram's 1000 byte limit"),
        (with_private(private="ह" * 334), "private text over 1000 bytes in a 3-byte script"),
        (with_private(private="Claim it: http://evil.test/x"), "private link not from the data"),
        (with_private(confidence=0.3), "low confidence"),
        (with_private(reply=PUBLIC, needs_human=True), "the model asks for a person"),
        (with_private(reply="x" * 301), "public reply over its limit"),
    ],
)
async def test_any_doubt_sends_neither_message_and_asks_a_human(
    enabled: Case, answer: str, why: str
) -> None:
    await generate(enabled, answer)
    assert await enabled.outbound() == [], why
    assert await enabled.jobs("send_comment_reply") == []
    assert await enabled.jobs("send_private_reply") == []
    assert len(await enabled.handoffs()) == 1


async def test_private_text_is_measured_in_bytes_and_the_limit_is_inclusive(
    enabled: Case,
) -> None:
    await generate(enabled, with_private(private="ह" * 333))  # 999 bytes
    assert len(await enabled.outbound()) == 2


async def test_exactly_one_thousand_bytes_is_allowed(enabled: Case) -> None:
    await generate(enabled, with_private(private="a" * 1000))
    assert len(await enabled.outbound()) == 2


# ---- the same guards as any automated reply ----
async def test_a_duplicate_job_never_sends_a_second_private_message(enabled: Case) -> None:
    await comment(enabled)
    job = await moderated_reply_job(enabled)
    assert job is not None
    await enabled.run(generate_comment_reply, SequenceGateway(with_private()), job)
    twin = await duplicate_of(enabled, job)
    await enabled.run(generate_comment_reply, SequenceGateway(with_private()), twin)
    assert len(await enabled.outbound()) == 2
    assert len(await enabled.jobs("send_private_reply")) == 1


async def test_a_takeover_during_the_model_call_discards_both_messages(enabled: Case) -> None:
    await comment(enabled)
    job = await moderated_reply_job(enabled)
    assert job is not None

    async def human_takes_over() -> None:
        async with enabled.factory() as session:
            await session.execute(
                update(Conversation)
                .where(Conversation.organization_id == enabled.org_id)
                .values(state=ConversationState.HUMAN_ACTIVE)
            )
            await session.commit()

    gateway = SequenceGateway(with_private(), on_call=human_takes_over)
    await enabled.run(generate_comment_reply, gateway, job)
    assert await enabled.outbound() == []
    assert await enabled.jobs("send_private_reply") == []


async def test_both_messages_count_toward_the_hourly_cap(enabled: Case) -> None:
    await enabled.update_ai_settings(max_replies_per_conversation_per_hour=2)
    await generate(enabled, with_private())
    assert len(await enabled.outbound()) == 2
    await comment(enabled, "And your hours?")
    second = (await enabled.jobs("moderate_message"))[1]
    await enabled.run(moderate_message, SequenceGateway(CLEAN), second)
    job = [
        j
        for j in await enabled.jobs("generate_comment_reply")
        if j.payload["message_id"] == second.payload["message_id"]
    ][0]
    gateway = SequenceGateway(with_private())
    await enabled.run(generate_comment_reply, gateway, job)
    assert gateway.calls == []  # cap reached: no model call, nothing more sent
    assert len(await enabled.outbound()) == 2


# ---- delivery ----
async def test_a_private_message_meta_refuses_is_marked_failed_and_a_person_is_asked(
    enabled: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    case = enabled
    await generate(case, with_private())
    public, private = await case.outbound()
    (private_job,) = await case.jobs("send_private_reply")
    (public_job,) = await case.jobs("send_comment_reply")
    ctx = deliver_ctx(case, api, cipher)
    await tracked(send_comment_reply, on_exhausted=give_up_sending)(ctx, str(public_job.id))

    # e.g. the comment is older than 7 days, or a private reply was already sent to it
    api.fail_with = InstagramApiError("cannot send", status_code=400, code=100)
    await tracked(send_private_reply, on_exhausted=give_up_sending)(ctx, str(private_job.id))

    async with case.factory() as session:
        stored_public = await session.get(Message, public.id)
        stored_private = await session.get(Message, private.id)
    assert stored_public is not None and stored_public.status is DeliveryStatus.SENT
    assert stored_private is not None and stored_private.status is DeliveryStatus.FAILED
    # The public reply said a message was sent, so a person must follow up.
    assert [h.reason.value for h in await case.handoffs()] == ["manual"]


async def test_transient_failure_retries_the_private_message_then_gives_up_to_a_person(
    enabled: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    await generate(enabled, with_private())
    (private_job,) = await enabled.jobs("send_private_reply")
    api.fail_with = InstagramApiError("unavailable", status_code=503)
    ctx = deliver_ctx(enabled, api, cipher)
    wrapped = tracked(send_private_reply, on_exhausted=give_up_sending)
    with pytest.raises(Retry):
        await wrapped(ctx | {"job_try": 1}, str(private_job.id))
    assert await enabled.handoffs() == []
    await wrapped(ctx | {"job_try": 3}, str(private_job.id))
    assert [h.reason.value for h in await enabled.handoffs()] == ["manual"]


async def test_the_capability_can_be_switched_off_after_the_message_was_queued(
    enabled: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    await generate(enabled, with_private())
    _, private = await enabled.outbound()
    (private_job,) = await enabled.jobs("send_private_reply")
    enabled.settings_overrides = {"feature_private_reply": False}
    await tracked(send_private_reply)(deliver_ctx(enabled, api, cipher), str(private_job.id))
    assert api.private_replies == []
    async with enabled.factory() as session:
        stored = await session.get(Message, private.id)
    assert stored is not None and stored.status is DeliveryStatus.SUPPRESSED


async def test_a_message_is_never_sent_twice(
    enabled: Case, api: FakeInstagramApi, cipher: TokenCipher
) -> None:
    await generate(enabled, with_private())
    (private_job,) = await enabled.jobs("send_private_reply")
    ctx = deliver_ctx(enabled, api, cipher)
    await send_private_reply(ctx, private_job.payload)
    await send_private_reply(ctx, private_job.payload)
    assert len(api.private_replies) == 1
