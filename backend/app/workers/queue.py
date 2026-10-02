import uuid
from typing import Any

import structlog
from arq.connections import ArqRedis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.base import utcnow
from app.models.enums import InstagramAccountStatus, ProcessingStatus
from app.models.instagram import InstagramAccount, Message, WebhookEvent
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


async def process_webhook_event(ctx: dict[str, Any], payload: dict[str, Any]) -> None:
    """EVENTS-queue handler: resolve the event to its tenant, dispatch, mark DONE.

    Import is local to avoid a circular import (this module is imported by app.main).
    """
    import uuid

    from redis.asyncio import Redis

    from app.models.enums import ProcessingStatus
    from app.services.events.dispatch import EventContext, dispatch
    from app.workers.errors import RetryableJobError

    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    redis: Redis = ctx["redis"]
    event_id = uuid.UUID(payload["webhook_event_id"])
    async with factory() as session:
        event = await session.get(WebhookEvent, event_id)
        if event is None:
            return
        if event.status is ProcessingStatus.DONE:
            return
        try:
            await dispatch(EventContext(session=session, redis=redis), event)
        except Exception as exc:
            event.status = ProcessingStatus.FAILED
            event.error_message = f"{type(exc).__name__}: {exc}"[:1000]
            await session.commit()
            raise RetryableJobError(str(exc)) from exc
        event.status = ProcessingStatus.DONE
        event.processed_at = utcnow()
        await session.commit()


async def send_instagram_message(ctx: dict[str, Any], payload: dict[str, Any]) -> None:
    """INSTAGRAM-queue handler: deliver one outbound Message via the Graph API.

    Local imports avoid a circular import (this module is imported by app.main).
    """
    import uuid

    from app.config.settings import Settings
    from app.models.enums import DeliveryStatus
    from app.services.instagram.capabilities import Capabilities, Feature
    from app.services.instagram.client import InstagramApi, InstagramApiError
    from app.services.instagram.crypto import TokenCipher, TokenDecryptionError
    from app.workers.errors import RetryableJobError

    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    settings: Settings = ctx["settings"]
    api: InstagramApi = ctx["instagram_api"]
    cipher: TokenCipher = ctx["token_cipher"]
    message_id = uuid.UUID(payload["message_id"])

    async with factory() as session:
        message = await session.get(Message, message_id)
        if message is None:
            return
        if message.status is not DeliveryStatus.PENDING:
            return  # already delivered or already given up on; never send twice

        if not Capabilities(settings).is_enabled(Feature.DM_REPLY):
            message.status = DeliveryStatus.SUPPRESSED
            await session.commit()
            return

        account = await session.get(InstagramAccount, message.instagram_account_id)
        if account is None or account.status != InstagramAccountStatus.ACTIVE:
            message.status = DeliveryStatus.FAILED
            await session.commit()
            return

        try:
            token = cipher.decrypt(account.access_token_encrypted)
            external_id = await api.send_dm(
                token, account.external_account_id, payload["recipient_external_id"], message.body
            )
        except TokenDecryptionError:
            message.status = DeliveryStatus.FAILED
            await session.commit()
            return
        except InstagramApiError as exc:
            if exc.is_token_error:
                account.status = InstagramAccountStatus.TOKEN_EXPIRED
                message.status = DeliveryStatus.FAILED
                await session.commit()
                return
            if exc.is_retryable:
                await session.commit()
                raise RetryableJobError(str(exc), retry_after=exc.retry_after) from exc
            message.status = DeliveryStatus.FAILED
            await session.commit()
            return

        message.status = DeliveryStatus.SENT
        message.external_message_id = external_id
        await session.commit()
