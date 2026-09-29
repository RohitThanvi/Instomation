"""Regression: a job stuck in PROCESSING (worker killed mid-run) must be recovered too, not just
jobs that never made it to Redis."""

from datetime import timedelta
from typing import Any

from arq import create_pool
from arq.connections import RedisSettings
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.models.base import utcnow
from app.models.enums import ProcessingStatus
from app.models.ops import Job
from app.workers.maintenance import requeue_stale_jobs
from app.workers.queues import QueueName
from tests.integration.conftest import REDIS_URL


async def test_requeue_recovers_jobs_stuck_in_processing(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    settings = get_settings()
    cutoff = timedelta(seconds=settings.job_requeue_after_seconds + 60)
    async with session_factory() as session:
        job = Job(
            queue=QueueName.EVENTS.value,
            kind="demo",
            status=ProcessingStatus.PROCESSING,
            payload={},
            updated_at=utcnow() - cutoff,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    try:
        ctx: dict[str, Any] = {
            "session_factory": session_factory,
            "settings": settings,
            "redis": pool,
        }
        await requeue_stale_jobs(ctx)
        queued = await pool.zrange(QueueName.EVENTS.redis_key, 0, -1)
        assert str(job_id).encode() in queued or str(job_id) in queued
    finally:
        await pool.aclose()
