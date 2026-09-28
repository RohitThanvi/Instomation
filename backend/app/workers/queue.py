import uuid
from typing import Any

import structlog
from arq.connections import ArqRedis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.enums import ProcessingStatus
from app.models.ops import Job
from app.workers.queues import QueueName

logger = structlog.get_logger(__name__)


class QueueUnavailableError(Exception):
    """Redis rejected the enqueue. The job stays PENDING and is re-enqueued by the sweeper."""


class JobQueue:
    """Durable enqueue: the Job row is committed before Redis is touched.

    A crash or Redis outage between the two steps leaves a PENDING row that
    `requeue_stale_jobs` picks up, so accepted work is never lost.
    """

    def __init__(self, pool: ArqRedis, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._pool = pool
        self._session_factory = session_factory

    async def enqueue(
        self,
        queue: QueueName,
        function: str,
        payload: dict[str, Any],
        organization_id: uuid.UUID | None = None,
        defer_by: float | None = None,
    ) -> uuid.UUID:
        async with self._session_factory() as session:
            job = Job(
                organization_id=organization_id,
                queue=queue.value,
                kind=function,
                status=ProcessingStatus.PENDING,
                payload=payload,
            )
            session.add(job)
            await session.commit()
            job_id = job.id
        await push_to_redis(self._pool, job_id, queue, function, defer_by)
        return job_id


async def push_to_redis(
    pool: ArqRedis,
    job_id: uuid.UUID,
    queue: QueueName,
    function: str,
    defer_by: float | None = None,
) -> None:
    """The Job UUID doubles as the arq job id, so repeated pushes are deduplicated by arq."""
    try:
        await pool.enqueue_job(
            function,
            str(job_id),
            _job_id=str(job_id),
            _queue_name=queue.redis_key,
            _defer_by=defer_by,
        )
    except RedisError as exc:
        logger.warning("enqueue_failed", job_id=str(job_id), queue=queue.value)
        raise QueueUnavailableError(str(job_id)) from exc
