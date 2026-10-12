"""index messages by organization and time for analytics

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Analytics aggregates one organization's messages over a date range. On a very large live
    # table build this CONCURRENTLY outside a transaction instead (it blocks writes while building).
    op.create_index("ix_messages_org_created", "messages", ["organization_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_messages_org_created", table_name="messages")
