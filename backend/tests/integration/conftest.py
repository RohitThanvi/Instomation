"""Integration fixtures. Require TEST_DATABASE_URL and TEST_REDIS_URL (CI provides both)."""

import os
from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from tests.integration.helpers import run_alembic

DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
REDIS_URL = os.environ.get("TEST_REDIS_URL", "")


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
