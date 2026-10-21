from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config.settings import Settings


def create_engine(settings: Settings, *, statement_timeout_ms: int) -> AsyncEngine:
    """`statement_timeout_ms` bounds how long any one query may run (0 for no limit).

    It is applied with a plain SET on each new connection rather than as a connection option, so
    it also works behind poolers that reject unknown startup parameters.
    """
    engine = create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_pre_ping=True,
    )
    if statement_timeout_ms > 0:

        @event.listens_for(engine.sync_engine, "connect")
        def _limit_statements(dbapi_connection: Any, _record: object) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute(f"SET statement_timeout = {int(statement_timeout_ms)}")
            finally:
                cursor.close()

    return engine


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
