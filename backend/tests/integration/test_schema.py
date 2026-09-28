"""Schema tests against a real PostgreSQL."""

import uuid

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.models import Base
from tests.integration.conftest import DATABASE_URL
from tests.integration.helpers import run_alembic


def test_migrations_match_models() -> None:
    run_alembic(DATABASE_URL, "check")


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
