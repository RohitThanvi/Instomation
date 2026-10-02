import uuid
from datetime import timedelta
from typing import Any

import pytest
from arq import Retry, create_pool
from arq.connections import RedisSettings
from arq.jobs import Job as ArqJob
from arq.jobs import JobStatus
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.core.retry import RetryPolicy
from app.models.base import utcnow
from app.models.enums import ProcessingStatus
from app.models.instagram import WebhookEvent
from app.models.ops import Job
from app.workers.errors import RetryableJobError
from app.workers.maintenance import purge_finished_records, requeue_stale_jobs
from app.workers.queue import JobQueue, push_to_redis
from app.workers.queues import QueueName
from app.workers.runtime import tracked
from tests.integration.conftest import REDIS_URL

MAX_TRIES = 3


def _ctx(factory: async_sessionmaker[AsyncSession], attempt: int = 1) -> dict[str, Any]:
    return {
        "session_factory": factory,
        "settings": get_settings(),
        "retry_policy": RetryPolicy(MAX_TRIES, base_seconds=1.0, cap_seconds=8.0),
        "job_try": attempt,
    }


async def _new_job(
    factory: async_sessionmaker[AsyncSession],
    status: ProcessingStatus = ProcessingStatus.PENDING,
    age: timedelta = timedelta(0),
) -> uuid.UUID:
    async with factory() as session:
        job = Job(
            queue=QueueName.EVENTS.value,
            kind="demo",
            status=status,
            payload={"n": 1},
            updated_at=utcnow() - age,
        )
        session.add(job)
        await session.commit()
        return job.id


async def _status(factory: async_sessionmaker[AsyncSession], job_id: uuid.UUID) -> Job | None:
    async with factory() as session:
        return await session.get(Job, job_id)


async def test_tracked_success_marks_done_and_passes_payload(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    seen: list[dict[str, Any]] = []

    async def handler(_: dict[str, Any], payload: dict[str, Any]) -> None:
        seen.append(payload)

    job_id = await _new_job(session_factory)
    await tracked(handler)(_ctx(session_factory), str(job_id))
    job = await _status(session_factory, job_id)
    assert job is not None and job.status is ProcessingStatus.DONE
    assert seen == [{"n": 1}]


async def test_tracked_skips_jobs_already_done(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    calls: list[int] = []

    async def handler(_: dict[str, Any], __: dict[str, Any]) -> None:
        calls.append(1)

    job_id = await _new_job(session_factory, ProcessingStatus.DONE)
    await tracked(handler)(_ctx(session_factory), str(job_id))
    assert calls == []


async def test_retryable_error_defers_and_keeps_job_pending(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def handler(_: dict[str, Any], __: dict[str, Any]) -> None:
        raise RetryableJobError("provider busy", retry_after=30)

    job_id = await _new_job(session_factory)
    with pytest.raises(Retry) as retry:
        await tracked(handler)(_ctx(session_factory), str(job_id))
    assert retry.value.defer_score >= 30_000
    job = await _status(session_factory, job_id)
    assert job is not None and job.status is ProcessingStatus.PENDING
    assert job.attempts == 1 and "provider busy" in (job.last_error or "")


async def test_retries_exhausted_marks_failed_without_raising(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def handler(_: dict[str, Any], __: dict[str, Any]) -> None:
        raise RetryableJobError("still busy")

    job_id = await _new_job(session_factory)
    await tracked(handler)(_ctx(session_factory, attempt=MAX_TRIES), str(job_id))
    job = await _status(session_factory, job_id)
    assert job is not None and job.status is ProcessingStatus.FAILED


async def test_unhandled_error_marks_failed_and_propagates(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def handler(_: dict[str, Any], __: dict[str, Any]) -> None:
        raise ValueError("bad payload")

    job_id = await _new_job(session_factory)
    with pytest.raises(ValueError, match="bad payload"):
        await tracked(handler)(_ctx(session_factory), str(job_id))
    job = await _status(session_factory, job_id)
    assert job is not None and job.status is ProcessingStatus.FAILED


async def test_enqueue_persists_job_and_is_deduplicated_in_redis(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    try:
        job_id = await JobQueue(pool, session_factory).enqueue(QueueName.EVENTS, "demo", {"n": 1})
        await push_to_redis(pool, job_id, QueueName.EVENTS, "demo")
        assert await pool.zcard(QueueName.EVENTS.redis_key) == 1
        status = await ArqJob(str(job_id), pool, _queue_name=QueueName.EVENTS.redis_key).status()
        assert status is JobStatus.queued
        assert (await _status(session_factory, job_id)) is not None
    finally:
        await pool.aclose()


async def test_requeue_recovers_pending_jobs_missing_from_redis(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    stale_id = await _new_job(session_factory, age=timedelta(days=1))
    fresh_id = await _new_job(session_factory)
    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    try:
        await requeue_stale_jobs({**_ctx(session_factory), "redis": pool})
        queued = await pool.zrange(QueueName.EVENTS.redis_key, 0, -1)
        assert queued == [str(stale_id).encode()] or queued == [str(stale_id)]
        refreshed = await _status(session_factory, stale_id)
        assert refreshed is not None and utcnow() - refreshed.updated_at < timedelta(minutes=1)
        assert str(fresh_id).encode() not in queued
    finally:
        await pool.aclose()


async def test_purge_removes_only_expired_finished_records(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    settings = get_settings()
    old = timedelta(days=settings.job_retention_days + 1)
    old_done = await _new_job(session_factory, ProcessingStatus.DONE, old)
    recent_done = await _new_job(session_factory, ProcessingStatus.DONE)
    old_pending = await _new_job(session_factory, ProcessingStatus.PENDING, old)
    old_external_id = f"evt-{uuid.uuid4()}"
    async with session_factory() as session:
        event = WebhookEvent(
            external_event_id=old_external_id,
            event_type="comments",
            payload_hash="h",
            payload_json={},
            status=ProcessingStatus.DONE,
            processed_at=utcnow() - timedelta(days=settings.webhook_event_retention_days + 1),
        )
        session.add(event)
        await session.commit()
        old_event_id = event.id

    await purge_finished_records(_ctx(session_factory))

    assert await _status(session_factory, old_done) is None
    assert await _status(session_factory, recent_done) is not None
    assert await _status(session_factory, old_pending) is not None
    async with session_factory() as session:
        assert await session.get(WebhookEvent, old_event_id) is None
