"""automation rules: keyword conditions, reply / handoff / skip actions

Downgrading deletes every automation rule: the previous table shape cannot hold them.

The automation_rules table has existed since the first migration, but nothing in the application
ever read or wrote it, and it described features that were never built (liking comments, notifying
the owner, matching on a topical intent that no part of the pipeline ever assigns to an allowed
message). It is reshaped here into what the rules engine actually does, and messages learn which
rule, if any, wrote them.

Revision ID: 0007
Revises: 0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_HANDOFF_REASONS = (
    "customer_requested",
    "complaint",
    "refund_dispute",
    "legal",
    "threat",
    "high_value_lead",
    "collaboration",
    "low_confidence",
    "missing_information",
    "repeated_dissatisfaction",
    "manual",
)


_CHECKS = {
    "action_fields": (
        "(action = 'reply' AND reply_text IS NOT NULL AND handoff_reason IS NULL)"
        " OR (action = 'handoff' AND handoff_reason IS NOT NULL"
        " AND reply_text IS NULL AND private_reply_text IS NULL)"
        " OR (action = 'skip' AND reply_text IS NULL AND private_reply_text IS NULL"
        " AND handoff_reason IS NULL)"
    ),
    "has_keyword": "cardinality(keywords) > 0",
    "private_scope": "private_reply_text IS NULL OR applies_to <> 'dm'",
    "reply_not_blank": "reply_text IS NULL OR btrim(reply_text) <> ''",
}


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=40)


def upgrade() -> None:
    existing = op.get_bind().execute(sa.text("SELECT count(*) FROM automation_rules")).scalar_one()
    if existing:
        # Nothing ever wrote to this table, so rows can only have been added by hand. Their old
        # shape has no equivalent (no action in the new vocabulary), so refuse rather than guess.
        raise RuntimeError(
            f"automation_rules holds {existing} row(s) in the old format. The application never "
            "used them; export or delete them, then run this migration again."
        )
    # Dropping `action` also drops its CHECK on the old CommentAction values, which would
    # otherwise reject the new ones.
    for column in ("action", "require_human", "notify_owner", "config", "trigger_intents"):
        op.drop_column("automation_rules", column)
    op.add_column(
        "automation_rules",
        sa.Column(
            "keywords", postgresql.ARRAY(sa.String(length=60)), server_default="{}", nullable=False
        ),
    )
    op.add_column(
        "automation_rules",
        sa.Column(
            "keyword_match",
            _enum("keywordmatch", "any", "all"),
            server_default="any",
            nullable=False,
        ),
    )
    op.add_column(
        "automation_rules",
        sa.Column("action", _enum("ruleaction", "reply", "handoff", "skip"), nullable=False),
    )
    op.add_column("automation_rules", sa.Column("reply_text", sa.Text(), nullable=True))
    op.add_column("automation_rules", sa.Column("private_reply_text", sa.Text(), nullable=True))
    op.add_column(
        "automation_rules",
        sa.Column("handoff_reason", _enum("handoffreason", *_HANDOFF_REASONS), nullable=True),
    )

    for name, condition in _CHECKS.items():
        op.create_check_constraint(
            op.f(f"ck_automation_rules_{name}"), "automation_rules", condition
        )

    op.add_column("messages", sa.Column("automation_rule_id", sa.UUID(), nullable=True))
    op.create_index(
        op.f("ix_messages_automation_rule_id"), "messages", ["automation_rule_id"], unique=False
    )
    op.create_foreign_key(
        op.f("fk_messages_automation_rule_id_automation_rules"),
        "messages",
        "automation_rules",
        ["automation_rule_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_messages_automation_rule_id_automation_rules"), "messages", type_="foreignkey"
    )
    op.drop_index(op.f("ix_messages_automation_rule_id"), table_name="messages")
    op.drop_column("messages", "automation_rule_id")

    # The old table shape cannot represent a rule (no keywords, no reply text), so rules do not
    # survive a downgrade. Clearing them also keeps downgrade-then-upgrade working: the upgrade
    # refuses a table that still holds rows in the old format.
    op.execute("DELETE FROM automation_rules")
    for column in (
        "handoff_reason",
        "private_reply_text",
        "reply_text",
        "action",
        "keyword_match",
        "keywords",
    ):
        op.drop_column("automation_rules", column)
    op.add_column(
        "automation_rules",
        sa.Column(
            "trigger_intents",
            postgresql.ARRAY(sa.String(length=40)),
            server_default="{}",
            nullable=False,
        ),
    )
    op.alter_column("automation_rules", "trigger_intents", server_default=None)
    op.add_column(
        "automation_rules",
        sa.Column(
            "config", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False
        ),
    )
    op.add_column(
        "automation_rules",
        sa.Column("notify_owner", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "automation_rules",
        sa.Column("require_human", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "automation_rules",
        sa.Column(
            "action",
            _enum("commentaction", "ignore", "like", "reply", "dm_if_permitted", "escalate"),
            nullable=True,
        ),
    )
