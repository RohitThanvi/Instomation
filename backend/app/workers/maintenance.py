from datetime import timedelta
from typing import Any, cast

import structlog
from arq.connections import ArqRedis
from sqlalchemy import delete, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import Settings
from app.models.base import utcnow
from app.models.enums import InstagramAccountStatus, ProcessingStatus
from app.models.instagram import InstagramAccount, WebhookEvent
from app.models.ops import Job
from app.services.instagram.client import InstagramApi, InstagramApiError
from app.services.instagram.crypto import TokenCipher, TokenDecryptionError
from app.workers.queue import QueueUnavailableError, push_to_redis
from app.workers.queues import QueueName

logger = structlog.get_logger(__name__)

_REQUEUE_BATCH = 500
_REFRESH_BATCH = 200


async def purge_finished_records(ctx: dict[str, Any]) -> None:
    """Delete completed jobs and processed webhook payloads past their retention window."""
    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    settings: Settings = ctx["settings"]
    now = utcnow()
    async with factory() as session:
        jobs = cast(
            "CursorResult[Any]",
            await session.execute(
                delete(Job).where(
                    Job.status == ProcessingStatus.DONE,
                    Job.updated_at < now - timedelta(days=settings.job_retention_days),
                )
            ),
        )
        events = cast(
            "CursorResult[Any]",
            await session.execute(
                delete(WebhookEvent).where(
                    WebhookEvent.status == ProcessingStatus.DONE,
                    WebhookEvent.processed_at
                    < now - timedelta(days=settings.webhook_event_retention_days),
                )
            ),
        )
        await session.commit()
    logger.info("retention_purge", jobs=jobs.rowcount, webhook_events=events.rowcount)


async def requeue_stale_jobs(ctx: dict[str, Any]) -> None:
    """Re-enqueue PENDING jobs whose Redis entry was lost (outage or crash before enqueue)."""
    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    settings: Settings = ctx["settings"]
    pool: ArqRedis = ctx["redis"]
    cutoff = utcnow() - timedelta(seconds=settings.job_requeue_after_seconds)
    async with factory() as session:
        stale = (
            await session.execute(
                select(Job.id, Job.queue, Job.kind)
                .where(Job.status == ProcessingStatus.PENDING, Job.updated_at < cutoff)
                .order_by(Job.updated_at)
                .limit(_REQUEUE_BATCH)
            )
        ).all()
        requeued = []
        for job_id, queue, kind in stale:
            try:
                await push_to_redis(pool, job_id, QueueName(queue), kind)
            except QueueUnavailableError:
                break
            requeued.append(job_id)
        if requeued:
            await session.execute(
                update(Job).where(Job.id.in_(requeued)).values(updated_at=utcnow())
            )
            await session.commit()
    if requeued:
        logger.warning("jobs_requeued", count=len(requeued))


async def refresh_instagram_tokens(ctx: dict[str, Any]) -> None:
    """Refresh long-lived tokens nearing expiry; flag accounts that need re-authorization."""
    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    settings: Settings = ctx["settings"]
    api: InstagramApi = ctx["instagram_api"]
    cipher: TokenCipher = ctx["token_cipher"]
    now = utcnow()
    horizon = now + timedelta(days=settings.token_refresh_window_days)
    refreshed = expired = 0
    async with factory() as session:
        accounts = (
            await session.execute(
                select(InstagramAccount)
                .where(
                    InstagramAccount.status == InstagramAccountStatus.ACTIVE,
                    InstagramAccount.deleted_at.is_(None),
                    InstagramAccount.token_expires_at < horizon,
                )
                .order_by(InstagramAccount.token_expires_at)
                .limit(_REFRESH_BATCH)
            )
        ).scalars()
        for account in accounts:
            if account.token_expires_at is not None and account.token_expires_at <= now:
                account.status = InstagramAccountStatus.TOKEN_EXPIRED
                expired += 1
                continue
            try:
                token = await api.refresh_token(cipher.decrypt(account.access_token_encrypted))
            except TokenDecryptionError:
                account.status = InstagramAccountStatus.TOKEN_EXPIRED
                expired += 1
            except InstagramApiError as exc:
                if exc.is_token_error:
                    account.status = InstagramAccountStatus.TOKEN_EXPIRED
                    expired += 1
                else:
                    logger.warning("token_refresh_deferred", account_id=str(account.id))
            else:
                account.access_token_encrypted = cipher.encrypt(token.access_token)
                account.token_expires_at = token.expires_at
                refreshed += 1
        await session.commit()
    logger.info("instagram_token_refresh", refreshed=refreshed, expired=expired)
