import uuid
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Computed,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDelete, TenantOwned, Timestamps, UUIDPrimaryKey, enum_column
from app.models.enums import (
    CommunicationStyle,
    HandoffReason,
    KeywordMatch,
    KnowledgeKind,
    OffHoursPolicy,
    RuleAction,
    RuleScope,
)


class BusinessProfile(UUIDPrimaryKey, TenantOwned, Timestamps, Base):
    __tablename__ = "business_profiles"
    __table_args__ = (UniqueConstraint("organization_id"),)

    brand_name: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    industry: Mapped[str | None] = mapped_column(String(120))
    location: Mapped[str | None] = mapped_column(String(200))
    website: Mapped[str | None] = mapped_column(String(500))
    contact_info: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    policies: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    communication_style: Mapped[CommunicationStyle] = mapped_column(
        enum_column(CommunicationStyle), default=CommunicationStyle.PROFESSIONAL
    )
    custom_instructions: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")
    working_hours: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    off_hours_policy: Mapped[OffHoursPolicy] = mapped_column(
        enum_column(OffHoursPolicy),
        default=OffHoursPolicy.RESPOND,
        server_default=OffHoursPolicy.RESPOND.value,
    )
    off_hours_message: Mapped[str | None] = mapped_column(Text)


class AiSettings(UUIDPrimaryKey, TenantOwned, Timestamps, Base):
    __tablename__ = "ai_settings"
    __table_args__ = (UniqueConstraint("organization_id"),)

    provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(100))
    max_response_tokens: Mapped[int] = mapped_column(Integer, default=300, server_default="300")
    temperature: Mapped[float] = mapped_column(Float, default=0.4, server_default="0.4")
    confidence_threshold: Mapped[float] = mapped_column(Float, default=0.7, server_default="0.7")
    comment_automation_enabled: Mapped[bool] = mapped_column(default=False, server_default="false")
    dm_automation_enabled: Mapped[bool] = mapped_column(default=False, server_default="false")
    private_reply_enabled: Mapped[bool] = mapped_column(default=False, server_default="false")
    comment_like_enabled: Mapped[bool] = mapped_column(default=False, server_default="false")
    max_replies_per_conversation_per_hour: Mapped[int] = mapped_column(
        Integer, default=10, server_default="10"
    )


class KnowledgeDocument(UUIDPrimaryKey, TenantOwned, Timestamps, SoftDelete, Base):
    __tablename__ = "knowledge_documents"

    kind: Mapped[KnowledgeKind] = mapped_column(enum_column(KnowledgeKind))
    title: Mapped[str] = mapped_column(String(300))
    source_url: Mapped[str | None] = mapped_column(String(500))


class KnowledgeEntry(UUIDPrimaryKey, TenantOwned, Timestamps, SoftDelete, Base):
    __tablename__ = "knowledge_entries"
    __table_args__ = (
        Index("ix_knowledge_entries_search", "search_vector", postgresql_using="gin"),
    )

    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_documents.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[KnowledgeKind] = mapped_column(enum_column(KnowledgeKind), index=True)
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))",
            persisted=True,
        ),
    )


class AutomationRule(UUIDPrimaryKey, TenantOwned, Timestamps, SoftDelete, Base):
    """IF a message matches THEN do this, evaluated before any AI call. The first enabled rule (by
    `priority`, lowest first) that applies to the channel and matches wins; with none, the AI
    answers."""

    __tablename__ = "automation_rules"
    # The shapes the API enforces, held by the database too, so the reply pipeline never meets a
    # rule it cannot act on (a reply with no text, a handoff with no reason, no keyword).
    __table_args__ = (
        CheckConstraint(
            "(action = 'reply' AND reply_text IS NOT NULL AND handoff_reason IS NULL)"
            " OR (action = 'handoff' AND handoff_reason IS NOT NULL"
            " AND reply_text IS NULL AND private_reply_text IS NULL)"
            " OR (action = 'skip' AND reply_text IS NULL AND private_reply_text IS NULL"
            " AND handoff_reason IS NULL)",
            name="action_fields",
        ),
        CheckConstraint("cardinality(keywords) > 0", name="has_keyword"),
        CheckConstraint("private_reply_text IS NULL OR applies_to <> 'dm'", name="private_scope"),
        CheckConstraint("reply_text IS NULL OR btrim(reply_text) <> ''", name="reply_not_blank"),
    )

    name: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(default=True, server_default="true")
    priority: Mapped[int] = mapped_column(Integer, default=100, server_default="100")
    applies_to: Mapped[RuleScope] = mapped_column(enum_column(RuleScope))
    # The message must contain any or all of these (per `keyword_match`); at least one is required.
    keywords: Mapped[list[str]] = mapped_column(ARRAY(String(60)))
    keyword_match: Mapped[KeywordMatch] = mapped_column(
        enum_column(KeywordMatch), default=KeywordMatch.ANY, server_default=KeywordMatch.ANY.value
    )
    action: Mapped[RuleAction] = mapped_column(enum_column(RuleAction))
    reply_text: Mapped[str | None] = mapped_column(Text)
    # A comment rule may also send one private message to the commenter (see private replies).
    private_reply_text: Mapped[str | None] = mapped_column(Text)
    handoff_reason: Mapped[HandoffReason | None] = mapped_column(enum_column(HandoffReason))
