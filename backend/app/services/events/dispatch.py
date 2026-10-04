"""Routes a persisted webhook event to the handler for its type.

Phase 7-8 gave every event a durable row and an at-least-once delivery guarantee. Phase 9 adds the
handlers themselves: turning a comment/message event into customer + conversation + message rows.
Comment/DM *automation* (classification, AI response, sending) is built in later phases and
registers itself here instead of changing the dispatch loop.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import structlog
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import ProcessingStatus
from app.models.instagram import WebhookEvent
from app.models.ops import Job
from app.workers.queues import QueueName

logger = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class DeferredJob:
    job_id: uuid.UUID
    queue: QueueName
    function: str


@dataclass(slots=True)
class EventContext:
    session: AsyncSession
    redis: Redis
    deferred_jobs: list[DeferredJob] = field(default_factory=list)

    async def defer_job(
        self,
        queue: QueueName,
        function: str,
        payload: dict[str, Any],
        organization_id: uuid.UUID,
    ) -> None:
        """Record follow-up work in the same transaction as the handler's writes. The caller of
        `dispatch` pushes it to Redis only after that transaction commits, so a job can never run
        before the rows it refers to exist; if the push fails the PENDING row is swept up later."""
        job = Job(
            organization_id=organization_id,
            queue=queue.value,
            kind=function,
            status=ProcessingStatus.PENDING,
            payload=payload,
        )
        self.session.add(job)
        await self.session.flush()
        self.deferred_jobs.append(DeferredJob(job.id, queue, function))


EventHandler = Callable[[EventContext, WebhookEvent], Awaitable[None]]

_HANDLERS: dict[str, EventHandler] = {}


def register(event_type: str) -> Callable[[EventHandler], EventHandler]:
    def decorator(handler: EventHandler) -> EventHandler:
        _HANDLERS[event_type] = handler
        return handler

    return decorator


async def dispatch(ctx: EventContext, event: WebhookEvent) -> None:
    handler = _HANDLERS.get(event.event_type)
    if handler is None:
        logger.info("webhook_event_type_unhandled", event_type=event.event_type)
        return
    await handler(ctx, event)


def registered_types() -> frozenset[str]:
    return frozenset(_HANDLERS)


# Reset hook for tests only.
def _clear_for_tests() -> dict[str, EventHandler]:
    saved = dict(_HANDLERS)
    _HANDLERS.clear()
    return saved


def _restore_for_tests(saved: dict[str, EventHandler]) -> None:
    _HANDLERS.clear()
    _HANDLERS.update(saved)
