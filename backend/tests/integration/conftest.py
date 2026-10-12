"""Integration fixtures. Require TEST_DATABASE_URL and TEST_REDIS_URL (CI provides both)."""

import os
from collections.abc import AsyncIterator, Iterator
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config.settings import get_settings
from app.services.instagram.crypto import TokenCipher
from tests.integration.helpers import run_alembic

DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
REDIS_URL = os.environ.get("TEST_REDIS_URL", "")


def _refuse_unsafe_targets() -> None:
    """These fixtures drop every table and flush Redis, so only disposable targets are allowed."""
    if DATABASE_URL and not urlparse(DATABASE_URL).path.lstrip("/").endswith("_test"):
        raise pytest.UsageError(
            "TEST_DATABASE_URL must point at a database whose name ends in _test"
        )
    if REDIS_URL and urlparse(REDIS_URL).path.lstrip("/") in ("", "0"):
        raise pytest.UsageError("TEST_REDIS_URL must select a dedicated Redis database (e.g. /1)")


_refuse_unsafe_targets()


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    if DATABASE_URL and REDIS_URL:
        return
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL and TEST_REDIS_URL are required")
    for item in items:
        if "integration" in item.nodeid:
            item.add_marker(skip)


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> Iterator[None]:
    if not (DATABASE_URL and REDIS_URL):
        yield
        return
    run_alembic(DATABASE_URL, "downgrade", "base")
    run_alembic(DATABASE_URL, "upgrade", "head")
    yield
    run_alembic(DATABASE_URL, "downgrade", "base")


@pytest_asyncio.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(DATABASE_URL)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def redis() -> AsyncIterator[Redis]:
    client = Redis.from_url(REDIS_URL, decode_responses=True)
    await client.flushdb()
    yield client
    await client.flushdb()
    await client.aclose()


@pytest_asyncio.fixture
async def cipher() -> TokenCipher:
    return TokenCipher.from_settings(get_settings())


@pytest_asyncio.fixture
async def pool() -> AsyncIterator[ArqRedis]:
    """A real arq pool (what workers get as ctx["redis"]) on an emptied test Redis."""
    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    await pool.flushdb()
    yield pool
    await pool.flushdb()
    await pool.aclose()
