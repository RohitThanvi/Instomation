"""Schema tests against a real PostgreSQL. Set TEST_DATABASE_URL to run (CI provides one)."""

import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.models import Base

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
BACKEND_DIR = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set")


def _alembic(*args: str) -> None:
    env = {**os.environ, "DATABASE_URL": str(TEST_DATABASE_URL)}
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR, env=env, check=True)


@pytest.fixture(scope="module", autouse=True)
def migrated_database() -> Iterator[None]:
    _alembic("downgrade", "base")
    _alembic("upgrade", "head")
    yield
    _alembic("downgrade", "base")


@pytest_asyncio.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(str(TEST_DATABASE_URL))
    yield engine
    await engine.dispose()


def test_migrations_match_models() -> None:
    _alembic("check")


async def test_tenant_owned_tables_index_organization_id(engine: AsyncEngine) -> None:
    def collect(sync_conn: object) -> list[str]:
        inspector = inspect(sync_conn)  # type: ignore[arg-type]
        missing = []
        for table in Base.metadata.tables.values():
            if "organization_id" not in table.c:
                continue
            indexed = any(
                idx["column_names"] and idx["column_names"][0] == "organization_id"
                for idx in inspector.get_indexes(table.name)
            ) or any(
                uq["column_names"][0] == "organization_id"
                for uq in inspector.get_unique_constraints(table.name)
            )
            if not indexed:
                missing.append(table.name)
        return missing

    async with engine.connect() as conn:
        assert await conn.run_sync(collect) == []


async def test_duplicate_webhook_event_is_rejected(engine: AsyncEngine) -> None:
    insert = text(
        "INSERT INTO webhook_events (id, external_event_id, event_type, payload_hash,"
        " payload_json, status) VALUES (:id, :ext, 'comments', 'h', '{}', 'pending')"
    )
    external_id = f"evt-{uuid.uuid4()}"
    async with engine.begin() as conn:
        await conn.execute(insert, {"id": uuid.uuid4(), "ext": external_id})
    with pytest.raises(IntegrityError):
        async with engine.begin() as conn:
            await conn.execute(insert, {"id": uuid.uuid4(), "ext": external_id})


async def test_invalid_enum_value_is_rejected(engine: AsyncEngine) -> None:
    with pytest.raises(IntegrityError):
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO organizations (id, name, account_type)"
                    " VALUES (:id, 'x', 'not-a-type')"
                ),
                {"id": uuid.uuid4()},
            )
