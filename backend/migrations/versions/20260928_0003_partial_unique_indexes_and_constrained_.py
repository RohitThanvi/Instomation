"""partial unique indexes and constrained enums

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Free-text columns become constrained enums (VARCHAR + CHECK, matching enum_column()).
    # Backfill first so the constraint can be created on databases that already hold rows.
    op.execute(
        "UPDATE automation_rules SET applies_to = 'both' WHERE applies_to NOT IN ('comment', 'dm', 'both')"
    )
    op.execute(
        "UPDATE business_profiles SET off_hours_policy = 'respond' "
        "WHERE off_hours_policy NOT IN ('respond', 'auto_reply', 'defer', 'escalate')"
    )
    op.alter_column(
        "automation_rules", "applies_to", type_=sa.String(length=40), existing_nullable=False
    )
    op.alter_column(
        "business_profiles", "off_hours_policy", type_=sa.String(length=40), existing_nullable=False
    )
    op.create_check_constraint(
        op.f("ck_automation_rules_rulescope"),
        "automation_rules",
        "applies_to IN ('comment', 'dm', 'both')",
    )
    op.create_check_constraint(
        op.f("ck_business_profiles_offhourspolicy"),
        "business_profiles",
        "off_hours_policy IN ('respond', 'auto_reply', 'defer', 'escalate')",
    )

    # Soft-deleted rows must not block re-creating the same customer/conversation.
    op.drop_constraint(
        op.f("uq_conversations_instagram_account_id"), "conversations", type_="unique"
    )
    op.create_index(
        "uq_conversations_account_customer_active",
        "conversations",
        ["instagram_account_id", "customer_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_constraint(op.f("uq_customers_instagram_account_id"), "customers", type_="unique")
    op.create_index(
        "uq_customers_account_external_user_active",
        "customers",
        ["instagram_account_id", "external_user_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_customers_account_external_user_active", table_name="customers")
    op.create_unique_constraint(
        op.f("uq_customers_instagram_account_id"),
        "customers",
        ["instagram_account_id", "external_user_id"],
    )
    op.drop_index("uq_conversations_account_customer_active", table_name="conversations")
    op.create_unique_constraint(
        op.f("uq_conversations_instagram_account_id"),
        "conversations",
        ["instagram_account_id", "customer_id"],
    )
    op.drop_constraint(
        op.f("ck_business_profiles_offhourspolicy"), "business_profiles", type_="check"
    )
    op.drop_constraint(op.f("ck_automation_rules_rulescope"), "automation_rules", type_="check")
    op.alter_column(
        "business_profiles", "off_hours_policy", type_=sa.String(length=24), existing_nullable=False
    )
    op.alter_column(
        "automation_rules", "applies_to", type_=sa.String(length=16), existing_nullable=False
    )
