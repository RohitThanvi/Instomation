"""record where each message lives (DM, public comment thread, private reply)

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "channel",
            sa.Enum(
                "dm",
                "comment",
                "private_reply",
                name="messagechannel",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=True,
        ),
    )
    # Backfill. Internal notes keep NULL (they never leave the app).
    # Inbound comments are stored with a "comment:" external id.
    op.execute(
        "UPDATE messages SET channel = 'comment' "
        "WHERE origin = 'customer' AND external_message_id LIKE 'comment:%'"
    )
    # An AI reply's channel is known from the send job that delivered it. Jobs are purged after
    # JOB_RETENTION_DAYS, so a comment reply whose job is already gone falls through to 'dm' below.
    op.execute(
        "UPDATE messages AS m SET channel = "
        "CASE j.kind WHEN 'send_private_reply' THEN 'private_reply' ELSE 'comment' END "
        "FROM jobs AS j "
        "WHERE j.kind IN ('send_comment_reply', 'send_private_reply') "
        "AND m.id = (j.payload ->> 'message_id')::uuid "
        "AND m.origin = 'ai'"
    )
    op.execute(
        "UPDATE messages SET channel = 'dm' WHERE channel IS NULL AND origin <> 'internal_note'"
    )


def downgrade() -> None:
    op.drop_column("messages", "channel")
