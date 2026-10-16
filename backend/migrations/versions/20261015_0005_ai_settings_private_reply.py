"""let an organization choose whether the assistant also replies to commenters in private

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Off by default: an existing organization's behavior does not change until it opts in.
    op.add_column(
        "ai_settings",
        sa.Column("private_reply_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("ai_settings", "private_reply_enabled")
