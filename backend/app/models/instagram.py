import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    SoftDelete,
    TenantOwned,
    Timestamps,
    UUIDPrimaryKey,
    enum_column,
    utcnow,
)
from app.models.enums import (
    CommentAction,
    ConversationState,
    DeliveryStatus,
    InstagramAccountStatus,
    Intent,
    MessageDirection,
    MessageOrigin,
    Priority,
    ProcessingStatus,
)


def _fk(target: str, *, ondelete: str = "CASCADE", nullable: bool = False) -> Mapped[Any]:
    return mapped_column(
        UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), index=True, nullable=nullable
    )


class InstagramAccount(UUIDPrimaryKey, TenantOwned, Timestamps, SoftDelete, Base):
    __tablename__ = "instagram_accounts"

    external_account_id: Mapped[str] = mapped_column(String(64), unique=True)
    username: Mapped[str] = mapped_column(String(64))
    status: Mapped[InstagramAccountStatus] = mapped_column(
        enum_column(InstagramAccountStatus), index=True
    )
    access_token_encrypted: Mapped[bytes] = mapped_column(LargeBinary)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    granted_permissions: Mapped[list[str]] = mapped_column(
        ARRAY(String(100)), default=list, server_default="{}"
    )
    webhook_subscribed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class Customer(UUIDPrimaryKey, TenantOwned, Timestamps, SoftDelete, Base):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("instagram_account_id", "external_user_id"),)

    instagram_account_id: Mapped[uuid.UUID] = _fk("instagram_accounts.id")
    external_user_id: Mapped[str] = mapped_column(String(64))
    username: Mapped[str | None] = mapped_column(String(64))
    display_name: Mapped[str | None] = mapped_column(String(200))
    facts: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")


class Conversation(UUIDPrimaryKey, TenantOwned, Timestamps, SoftDelete, Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("instagram_account_id", "customer_id"),
        Index("ix_conversations_inbox", "organization_id", "state", "last_message_at"),
    )

    instagram_account_id: Mapped[uuid.UUID] = _fk("instagram_accounts.id")
    customer_id: Mapped[uuid.UUID] = _fk("customers.id")
    state: Mapped[ConversationState] = mapped_column(
        enum_column(ConversationState), default=ConversationState.AI_ACTIVE
    )
    priority: Mapped[Priority] = mapped_column(enum_column(Priority), default=Priority.NORMAL)
    last_intent: Mapped[Intent | None] = mapped_column(enum_column(Intent))
    is_lead: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(50)), default=list, server_default="{}")
    summary: Mapped[str | None] = mapped_column(Text)
    unread_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    assigned_user_id: Mapped[uuid.UUID | None] = _fk("users.id", ondelete="SET NULL", nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(UUIDPrimaryKey, TenantOwned, Timestamps, Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("instagram_account_id", "external_message_id"),
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    instagram_account_id: Mapped[uuid.UUID] = _fk("instagram_accounts.id")
    conversation_id: Mapped[uuid.UUID] = _fk("conversations.id")
    external_message_id: Mapped[str | None] = mapped_column(String(128))
    direction: Mapped[MessageDirection] = mapped_column(enum_column(MessageDirection))
    origin: Mapped[MessageOrigin] = mapped_column(enum_column(MessageOrigin))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[DeliveryStatus] = mapped_column(enum_column(DeliveryStatus), index=True)
    intent: Mapped[Intent | None] = mapped_column(enum_column(Intent))
    ai_confidence: Mapped[float | None] = mapped_column()
    moderation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    author_user_id: Mapped[uuid.UUID | None] = _fk("users.id", ondelete="SET NULL", nullable=True)


class Comment(UUIDPrimaryKey, TenantOwned, Timestamps, Base):
    __tablename__ = "comments"
    __table_args__ = (UniqueConstraint("instagram_account_id", "external_comment_id"),)

    instagram_account_id: Mapped[uuid.UUID] = _fk("instagram_accounts.id")
    external_comment_id: Mapped[str] = mapped_column(String(64))
    external_media_id: Mapped[str] = mapped_column(String(64), index=True)
    external_parent_id: Mapped[str | None] = mapped_column(String(64))
    author_external_id: Mapped[str | None] = mapped_column(String(64))
    author_username: Mapped[str | None] = mapped_column(String(64))
    body: Mapped[str] = mapped_column(Text)
    intent: Mapped[Intent | None] = mapped_column(enum_column(Intent))
    action: Mapped[CommentAction | None] = mapped_column(enum_column(CommentAction))
    status: Mapped[ProcessingStatus] = mapped_column(enum_column(ProcessingStatus), index=True)
    reply_external_id: Mapped[str | None] = mapped_column(String(64))
    moderation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class WebhookEvent(UUIDPrimaryKey, Base):
    __tablename__ = "webhook_events"
    __table_args__ = (Index("ix_webhook_events_status_received", "status", "received_at"),)

    organization_id: Mapped[uuid.UUID | None] = _fk("organizations.id", nullable=True)
    instagram_account_id: Mapped[uuid.UUID | None] = _fk("instagram_accounts.id", nullable=True)
    external_event_id: Mapped[str] = mapped_column(String(200), unique=True)
    event_type: Mapped[str] = mapped_column(String(64))
    payload_hash: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[ProcessingStatus] = mapped_column(enum_column(ProcessingStatus))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
