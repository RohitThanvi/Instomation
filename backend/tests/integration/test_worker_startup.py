from typing import Any

import pytest
from sqlalchemy import text

from app.config.settings import get_settings
from app.workers import settings as worker_settings
from tests.integration.conftest import DATABASE_URL, REDIS_URL

_STATEMENT_LIMIT_MS = text(
    "SELECT (EXTRACT(EPOCH FROM current_setting('statement_timeout')::interval) * 1000)::bigint"
)


async def test_worker_queries_may_run_as_long_as_a_job_may(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings().model_copy(
        update={"database_url": DATABASE_URL, "redis_url": REDIS_URL, "job_timeout_seconds": 45}
    )
    monkeypatch.setattr(worker_settings, "_settings", settings)
    ctx: dict[str, Any] = {}
    await worker_settings._on_startup(ctx)
    try:
        async with ctx["engine"].connect() as connection:
            limit_ms = (await connection.execute(_STATEMENT_LIMIT_MS)).scalar_one()
    finally:
        await worker_settings._on_shutdown(ctx)
    assert limit_ms == 45_000
