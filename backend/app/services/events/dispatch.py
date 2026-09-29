"""Routes a persisted webhook event to the handler for its type.

Phase 7-8 scope: resolve the event to its tenant, mark it processed, and leave a clear extension
point. Comment/DM business logic (classification, AI response, sending) is built in later phases
and registers itself here instead of changing the dispatch loop.
"""

from collections.abc import Awaitable, Callable

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instagram import WebhookEvent

logger = structlog.get_logger(__name__)

EventHandler = Callable[[AsyncSession, WebhookEvent], Awaitable[None]]

_HANDLERS: dict[str, EventHandler] = {}


def register(event_type: str) -> Callable[[EventHandler], EventHandler]:
    def decorator(handler: EventHandler) -> EventHandler:
        _HANDLERS[event_type] = handler
        return handler

    return decorator


async def dispatch(session: AsyncSession, event: WebhookEvent) -> None:
    handler = _HANDLERS.get(event.event_type)
    if handler is None:
        logger.info("webhook_event_type_unhandled", event_type=event.event_type)
        return
    await handler(session, event)


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
