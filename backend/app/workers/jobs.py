import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import ProcessingStatus
from app.models.ops import Job
from app.workers.queues import QueueName


async def add_job(
    session: AsyncSession,
    queue: QueueName,
    function: str,
    payload: dict[str, Any],
    organization_id: uuid.UUID,
) -> Job:
    """Write a PENDING `jobs` row inside the caller's transaction (flushed, so `job.id` is set).

    The caller pushes it to Redis only after committing (`push_to_redis`); if that push fails the
    committed row is picked up by `requeue_stale_jobs`. This is what makes follow-up work atomic
    with the data it refers to.
    """
    job = Job(
        organization_id=organization_id,
        queue=queue.value,
        kind=function,
        status=ProcessingStatus.PENDING,
        payload=payload,
    )
    session.add(job)
    await session.flush()
    return job
