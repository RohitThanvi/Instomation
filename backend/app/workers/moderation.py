import contextlib
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import Settings
from app.services.ai.gateway import AIGateway, AIGatewayError
from app.services.moderation.classifier import ModerationClassifier
from app.services.moderation.service import moderate_message as moderate
from app.services.moderation.types import ModerationAction
from app.workers.errors import RetryableJobError
from app.workers.jobs import add_job
from app.workers.queue import QueueUnavailableError, push_to_redis
from app.workers.queues import QueueName

REPLY_FUNCTION = "generate_dm_reply"


async def moderate_message(ctx: dict[str, Any], payload: dict[str, Any]) -> None:
    """AI-queue handler. Safety classification is the first AI step for every inbound message;
    only a DM that comes out `allow` is passed on to reply generation."""
    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    settings: Settings = ctx["settings"]
    gateway: AIGateway = ctx["ai_gateway"]
    classifier = ModerationClassifier(gateway, settings.moderation_max_tokens)
    message_id = uuid.UUID(payload["message_id"])
    async with factory() as session:
        try:
            decision = await moderate(session, classifier, settings, message_id)
        except AIGatewayError as exc:
            await session.rollback()
            raise RetryableJobError(str(exc), retry_after=exc.retry_after) from exc
        reply_job_id: uuid.UUID | None = None
        if (
            decision is not None
            and decision.action is ModerationAction.ALLOW
            and payload.get("channel") == "dm"
        ):
            job = await add_job(
                session,
                QueueName.AI,
                REPLY_FUNCTION,
                {"message_id": str(message_id)},
                uuid.UUID(payload["organization_id"]),
            )
            reply_job_id = job.id
        await session.commit()
    if reply_job_id is not None:
        # On failure the committed PENDING row is delivered later by requeue_stale_jobs.
        with contextlib.suppress(QueueUnavailableError):
            await push_to_redis(ctx["redis"], reply_job_id, QueueName.AI, REPLY_FUNCTION)
