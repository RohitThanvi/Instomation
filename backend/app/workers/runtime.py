import functools
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from arq import Retry
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.retry import RetryPolicy
from app.models.enums import ProcessingStatus
from app.models.ops import Job
from app.workers.errors import RetryableJobError

logger = structlog.get_logger(__name__)

Context = dict[str, Any]
Handler = Callable[[Context, dict[str, Any]], Awaitable[None]]

_MAX_ERROR_LENGTH = 1000


def _describe(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:_MAX_ERROR_LENGTH]


async def _mark(
    factory: async_sessionmaker[AsyncSession],
    job_id: uuid.UUID,
    status: ProcessingStatus,
    attempts: int | None = None,
    error: str | None = None,
) -> None:
    async with factory() as session:
        job = await session.get(Job, job_id)
        if job is None:
            return
        job.status = status
        if attempts is not None:
            job.attempts = attempts
        job.last_error = error
        await session.commit()


def tracked(
    handler: Handler, *, on_exhausted: Handler | None = None
) -> Callable[[Context, str], Awaitable[None]]:
    """Wrap a handler so its Job row reflects reality and failures follow the retry policy.

    Handlers receive `(ctx, payload)`; raise `RetryableJobError` for transient failures. When
    retries run out, `on_exhausted(ctx, payload)` runs once so the work is not silently dropped.
    Idempotent by construction: a job already DONE is skipped.
    """

    @functools.wraps(handler)
    async def wrapper(ctx: Context, job_id: str) -> None:
        factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
        policy: RetryPolicy = ctx["retry_policy"]
        attempt: int = ctx["job_try"]
        job_uuid = uuid.UUID(job_id)

        async with factory() as session:
            job = await session.get(Job, job_uuid)
            if job is None or job.status is ProcessingStatus.DONE:
                return
            payload = dict(job.payload)
            job.status = ProcessingStatus.PROCESSING
            job.attempts = attempt
            await session.commit()

        try:
            await handler(ctx, payload)
        except RetryableJobError as exc:
            if not policy.should_retry(attempt):
                await _mark(factory, job_uuid, ProcessingStatus.FAILED, attempt, _describe(exc))
                logger.error(
                    "job_failed", job_id=job_id, attempts=attempt, reason="retries_exhausted"
                )
                if on_exhausted is not None:
                    try:
                        await on_exhausted(ctx, payload)
                    except Exception:
                        logger.exception("on_exhausted_failed", job_id=job_id)
                return
            await _mark(factory, job_uuid, ProcessingStatus.PENDING, attempt, _describe(exc))
            raise Retry(defer=policy.delay(attempt, exc.retry_after)) from exc
        except Exception as exc:
            await _mark(factory, job_uuid, ProcessingStatus.FAILED, attempt, _describe(exc))
            logger.error("job_failed", job_id=job_id, attempts=attempt, reason="unhandled")
            raise
        await _mark(factory, job_uuid, ProcessingStatus.DONE, attempt)

    return wrapper
