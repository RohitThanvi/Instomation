import pytest
from sqlalchemy import text

import app.main as main
from app.config.settings import get_settings
from tests.integration.conftest import DATABASE_URL, REDIS_URL

_STATEMENT_LIMIT_MS = text(
    "SELECT (EXTRACT(EPOCH FROM current_setting('statement_timeout')::interval) * 1000)::bigint"
)


async def test_the_api_boots_with_the_configured_database_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings().model_copy(
        update={
            "database_url": DATABASE_URL,
            "redis_url": REDIS_URL,
            "db_statement_timeout_ms": 3210,
            "db_pool_timeout_seconds": 4.5,
        }
    )
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    app = main.create_app(settings)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with engine.connect() as connection:
            limit_ms = (await connection.execute(_STATEMENT_LIMIT_MS)).scalar_one()
        pool_timeout = engine.sync_engine.pool.timeout()
    assert limit_ms == 3210
    assert pool_timeout == 4.5
