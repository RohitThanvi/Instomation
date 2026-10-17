"""Migration 0006 backfills `messages.channel` from data that already exists.

The suite's database is migrated to head once per session; this test steps it back to 0005, seeds
rows the way earlier releases wrote them (no channel), upgrades, and checks every row. It always
leaves the database at head again.
"""

import json
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models.instagram import Conversation, Customer
from app.services.instagram.crypto import TokenCipher
from tests.integration.conftest import DATABASE_URL
from tests.integration.helpers import run_alembic
from tests.integration.test_conversations_flow import _org_and_account

_INSERT_MESSAGE = text(
    "INSERT INTO messages (id, organization_id, instagram_account_id, conversation_id,"
    " external_message_id, direction, origin, body, status)"
    " VALUES (:id, :org, :account, :conversation, :external, :direction, :origin, 'x', 'sent')"
)
_INSERT_JOB = text(
    "INSERT INTO jobs (id, organization_id, queue, kind, status, payload)"
    " VALUES (:id, :org, 'instagram', :kind, 'done', CAST(:payload AS jsonb))"
)


async def test_backfill_assigns_the_channel_each_existing_message_was_sent_on(
    engine: AsyncEngine, session_factory: async_sessionmaker[AsyncSession], cipher: TokenCipher
) -> None:
    _, org, account, _ = await _org_and_account(session_factory, cipher)
    async with session_factory() as session:
        customer = Customer(
            organization_id=org, instagram_account_id=account, external_user_id="cust-1"
        )
        session.add(customer)
        await session.flush()
        conversation = Conversation(
            organization_id=org, instagram_account_id=account, customer_id=customer.id
        )
        session.add(conversation)
        await session.commit()
        conversation_id = conversation.id
    await engine.dispose()

    rows = {
        "inbound_dm": ("inbound", "customer", "mid-1", None),
        "inbound_comment": ("inbound", "customer", "comment:178", None),
        "ai_dm": ("outbound", "ai", None, "send_instagram_message"),
        "ai_comment": ("outbound", "ai", None, "send_comment_reply"),
        "ai_private": ("outbound", "ai", None, "send_private_reply"),
        "ai_comment_job_purged": ("outbound", "ai", None, None),
        "human": ("outbound", "human", None, "send_instagram_message"),
        "note": ("outbound", "internal_note", None, None),
        # Only an AI reply is labelled from its send job: a message of another kind that a comment
        # job happens to point at must not be.
        "human_with_comment_job": ("outbound", "human", None, "send_comment_reply"),
    }
    ids = {name: uuid.uuid4() for name in rows}
    expected = {
        "inbound_dm": "dm",
        "inbound_comment": "comment",
        "ai_dm": "dm",
        "ai_comment": "comment",
        "ai_private": "private_reply",
        "ai_comment_job_purged": "dm",  # its job is gone, so the channel is unknowable: DM default
        "human": "dm",
        "note": None,
        "human_with_comment_job": "dm",
    }
    run_alembic(DATABASE_URL, "downgrade", "0005")
    try:
        async with engine.begin() as conn:
            for name, (direction, origin, external, job_kind) in rows.items():
                await conn.execute(
                    _INSERT_MESSAGE,
                    {
                        "id": ids[name],
                        "org": org,
                        "account": account,
                        "conversation": conversation_id,
                        "external": external,
                        "direction": direction,
                        "origin": origin,
                    },
                )
                if job_kind is not None:
                    await conn.execute(
                        _INSERT_JOB,
                        {
                            "id": uuid.uuid4(),
                            "org": org,
                            "kind": job_kind,
                            "payload": json.dumps({"message_id": str(ids[name])}),
                        },
                    )
        await engine.dispose()
        run_alembic(DATABASE_URL, "upgrade", "head")
        async with engine.connect() as conn:
            result = await conn.execute(
                text("SELECT id, channel FROM messages WHERE conversation_id = :c"),
                {"c": conversation_id},
            )
            actual = {row.id: row.channel for row in result}
    finally:
        await engine.dispose()
        run_alembic(DATABASE_URL, "upgrade", "head")

    assert {name: actual[ids[name]] for name in rows} == expected
