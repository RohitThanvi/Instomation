"""Migration 0007 reshapes the automation_rules table. It steps the shared test database down and
back up, and always leaves it at head."""

import asyncio
import os
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models.business import AutomationRule
from app.models.enums import RuleAction, RuleScope
from app.services.instagram.crypto import TokenCipher
from tests.integration.conftest import DATABASE_URL
from tests.integration.helpers import BACKEND_DIR, run_alembic
from tests.integration.test_conversations_flow import _org_and_account

_COUNT = text("SELECT count(*) FROM automation_rules")
# A row as the table's first shape allowed it, before anything understood rules.
_OLD_ROW = text(
    "INSERT INTO automation_rules (id, organization_id, name, applies_to, trigger_intents, action)"
    " VALUES (gen_random_uuid(), :org, 'old', 'dm', '{greeting}', 'ignore')"
)


async def _make_rule(
    session_factory: async_sessionmaker[AsyncSession], cipher: TokenCipher
) -> uuid.UUID:
    _, org, _, _ = await _org_and_account(session_factory, cipher)
    async with session_factory() as session:
        session.add(
            AutomationRule(
                organization_id=org,
                name="Delivery",
                applies_to=RuleScope.DM,
                keywords=["deliver"],
                action=RuleAction.REPLY,
                reply_text="We deliver!",
            )
        )
        await session.commit()
    return org


async def test_a_downgrade_clears_rules_so_it_can_be_applied_again(
    engine: AsyncEngine, session_factory: async_sessionmaker[AsyncSession], cipher: TokenCipher
) -> None:
    await _make_rule(session_factory, cipher)
    async with engine.connect() as connection:
        assert (await connection.execute(_COUNT)).scalar_one() >= 1
    await engine.dispose()
    try:
        run_alembic(DATABASE_URL, "downgrade", "0006")
        async with engine.connect() as connection:
            assert (await connection.execute(_COUNT)).scalar_one() == 0
        await engine.dispose()
        run_alembic(DATABASE_URL, "upgrade", "head")  # would fail on a leftover row
    finally:
        await engine.dispose()
        run_alembic(DATABASE_URL, "upgrade", "head")


async def test_the_upgrade_refuses_rows_in_the_old_shape_instead_of_guessing(
    engine: AsyncEngine, session_factory: async_sessionmaker[AsyncSession], cipher: TokenCipher
) -> None:
    _, org, _, _ = await _org_and_account(session_factory, cipher)
    await engine.dispose()
    try:
        run_alembic(DATABASE_URL, "downgrade", "0006")
        async with engine.begin() as connection:
            await connection.execute(text("DELETE FROM automation_rules"))
            await connection.execute(_OLD_ROW, {"org": org})
        await engine.dispose()
        failed = await asyncio.to_thread(
            subprocess.run,
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_DIR,
            env={**os.environ, "DATABASE_URL": DATABASE_URL},
            capture_output=True,
            text=True,
        )
        assert failed.returncode != 0
        assert "1 row(s) in the old format" in failed.stderr
        async with engine.connect() as connection:
            version = (
                await connection.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar_one()
        assert version == "0006"  # nothing was half-applied
        await engine.dispose()
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DELETE FROM automation_rules"))
        await engine.dispose()
        run_alembic(DATABASE_URL, "upgrade", "head")


@pytest.mark.parametrize(
    "values",
    [
        pytest.param("'dm', '{k}', 'reply', NULL", id="a reply with no text"),
        pytest.param("'dm', '{k}', 'handoff', NULL", id="a handoff with no reason"),
        pytest.param("'dm', '{k}', 'skip', 'hello'", id="a skip with text"),
        pytest.param("'dm', '{}', 'skip', NULL", id="no keywords"),
        pytest.param("'dm', '{k}', 'reply', '   '", id="a blank reply"),
    ],
)
async def test_the_database_itself_refuses_an_incoherent_rule(
    engine: AsyncEngine,
    session_factory: async_sessionmaker[AsyncSession],
    cipher: TokenCipher,
    values: str,
) -> None:
    """The API checks these too; the database is the backstop the reply pipeline relies on."""
    _, org, _, _ = await _org_and_account(session_factory, cipher)
    async with engine.begin() as connection:
        with pytest.raises(Exception, match="ck_automation_rules"):
            await connection.execute(
                text(
                    "INSERT INTO automation_rules (id, organization_id, name, applies_to,"
                    f" keywords, action, reply_text) SELECT gen_random_uuid(), :org, 'x', {values}"
                ),
                {"org": org},
            )


async def test_a_private_message_belongs_to_a_comment_rule_never_a_dm_rule(
    engine: AsyncEngine, session_factory: async_sessionmaker[AsyncSession], cipher: TokenCipher
) -> None:
    _, org, _, _ = await _org_and_account(session_factory, cipher)
    async with engine.begin() as connection:
        with pytest.raises(Exception, match="ck_automation_rules_private_scope"):
            await connection.execute(
                text(
                    "INSERT INTO automation_rules (id, organization_id, name, applies_to, keywords,"
                    " action, reply_text, private_reply_text) SELECT gen_random_uuid(), :org, 'x',"
                    " 'dm', '{k}', 'reply', 'hi', 'private'"
                ),
                {"org": org},
            )
