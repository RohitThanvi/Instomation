from typing import Any

import httpx
from arq import cron
from arq.connections import RedisSettings
from sqlalchemy.ext.asyncio import AsyncEngine

import app.services.events.handlers  # noqa: F401 - registers event handlers
from app.config.settings import get_settings
from app.core.logging import configure_logging
from app.core.retry import RetryPolicy
from app.db.session import create_engine, create_session_factory
from app.services.instagram.client import GraphInstagramApi
from app.services.instagram.crypto import TokenCipher
from app.workers.maintenance import (
    purge_finished_records,
    refresh_instagram_tokens,
    requeue_stale_jobs,
)
from app.workers.queue import process_webhook_event, send_instagram_message
from app.workers.queues import QueueName
from app.workers.runtime import tracked

_settings = get_settings()

# Task handlers per queue. Later phases register their `tracked` handlers here.
HANDLERS: dict[QueueName, list[Any]] = {
    QueueName.EVENTS: [tracked(process_webhook_event)],
    QueueName.INSTAGRAM: [tracked(send_instagram_message)],
}
_CRON_JOBS = {
    QueueName.MAINTENANCE: [
        cron(requeue_stale_jobs, minute=set(range(2, 60, 5))),
        cron(purge_finished_records, hour={3}, minute={17}),
        cron(refresh_instagram_tokens, hour={4}, minute={7}),
    ]
}


async def _on_startup(ctx: dict[str, Any]) -> None:
    configure_logging(_settings.log_level)
    engine = create_engine(_settings)
    ctx["settings"] = _settings
    ctx["engine"] = engine
    ctx["session_factory"] = create_session_factory(engine)
    http_client = httpx.AsyncClient()
    ctx["http_client"] = http_client
    ctx["instagram_api"] = GraphInstagramApi(http_client, _settings)
    ctx["token_cipher"] = TokenCipher.from_settings(_settings)
    ctx["retry_policy"] = RetryPolicy(
        max_attempts=_settings.job_max_tries,
        base_seconds=_settings.job_retry_base_seconds,
        cap_seconds=_settings.job_retry_cap_seconds,
    )


async def _on_shutdown(ctx: dict[str, Any]) -> None:
    http_client: httpx.AsyncClient = ctx["http_client"]
    await http_client.aclose()
    engine: AsyncEngine = ctx["engine"]
    await engine.dispose()


def _require_work(queue: QueueName) -> None:
    if not HANDLERS.get(queue) and not _CRON_JOBS.get(queue):
        raise RuntimeError(f"No handlers registered for queue '{queue.value}'.")


_require_work(_settings.worker_queue)


class WorkerSettings:
    """Run with: `arq app.workers.settings.WorkerSettings` (one process per WORKER_QUEUE)."""

    functions = HANDLERS.get(_settings.worker_queue, [])
    cron_jobs = _CRON_JOBS.get(_settings.worker_queue, [])
    queue_name = _settings.worker_queue.redis_key
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
    max_jobs = _settings.worker_max_jobs
    max_tries = _settings.job_max_tries
    job_timeout = _settings.job_timeout_seconds
    poll_delay = _settings.worker_poll_delay_seconds
    keep_result = 300
    on_startup = _on_startup
    on_shutdown = _on_shutdown
