"""add job queue column

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "jobs", sa.Column("queue", sa.String(length=32), nullable=False, server_default="events")
    )
    op.alter_column("jobs", "queue", server_default=None)


def downgrade() -> None:
    op.drop_column("jobs", "queue")
