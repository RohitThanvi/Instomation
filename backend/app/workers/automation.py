import contextlib
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import Settings
from app.models.enums import HandoffReason
from app.services.ai.gateway import AIGateway, AIGatewayError
from app.services.automation.dm_reply import generate_dm_reply as generate
from app.services.automation.escalation import escalate_conversation_of
from app.workers.errors import RetryableJobError
from app.workers.queue import QueueUnavailableError, push_to_redis
from app.workers.queues import QueueName


async def escalate_unanswered(ctx: dict[str, Any], payload: dict[str, Any]) -> None:
    """`on_exhausted` hook for AI-queue jobs: the provider stayed unavailable through every retry,
    so the customer would otherwise wait forever. A human is asked to take over."""
    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    async with factory() as session:
        await escalate_conversation_of(
            session, uuid.UUID(payload["message_id"]), HandoffReason.LOW_CONFIDENCE
        )
        await session.commit()


async def generate_dm_reply(ctx: dict[str, Any], payload: dict[str, Any]) -> None:
    """AI-queue handler: answer a moderated DM. The send job is created in the same transaction
    as the reply and pushed to Redis only after the commit."""
    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    settings: Settings = ctx["settings"]
    gateway: AIGateway = ctx["ai_gateway"]
    async with factory() as session:
        try:
            result = await generate(session, gateway, settings, uuid.UUID(payload["message_id"]))
        except AIGatewayError as exc:
            await session.rollback()
            raise RetryableJobError(str(exc), retry_after=exc.retry_after) from exc
        send = result.send_job
        pending = (send.id, QueueName(send.queue), send.kind) if send is not None else None
        await session.commit()
    if pending is not None:
        # On failure the committed PENDING row is delivered later by requeue_stale_jobs.
        with contextlib.suppress(QueueUnavailableError):
            await push_to_redis(ctx["redis"], pending[0], pending[1], pending[2])
