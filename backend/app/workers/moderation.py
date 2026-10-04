import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import Settings
from app.services.ai.gateway import AIGateway, AIGatewayError
from app.services.moderation.classifier import ModerationClassifier
from app.services.moderation.service import moderate_message as moderate
from app.workers.errors import RetryableJobError


async def moderate_message(ctx: dict[str, Any], payload: dict[str, Any]) -> None:
    """AI-queue handler. Safety classification is the first AI step for every inbound message."""
    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]
    settings: Settings = ctx["settings"]
    gateway: AIGateway = ctx["ai_gateway"]
    classifier = ModerationClassifier(gateway, settings.moderation_max_tokens)
    async with factory() as session:
        try:
            await moderate(session, classifier, settings, uuid.UUID(payload["message_id"]))
        except AIGatewayError as exc:
            await session.rollback()
            raise RetryableJobError(str(exc), retry_after=exc.retry_after) from exc
        await session.commit()
