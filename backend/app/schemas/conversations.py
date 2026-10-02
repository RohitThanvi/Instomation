import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import (
    ConversationState,
    DeliveryStatus,
    Intent,
    MessageDirection,
    MessageOrigin,
    Priority,
)


class CustomerOut(BaseModel):
    id: uuid.UUID
    external_user_id: str
    username: str | None
    display_name: str | None


class ConversationOut(BaseModel):
    id: uuid.UUID
    instagram_account_id: uuid.UUID
    customer: CustomerOut
    state: ConversationState
    priority: Priority
    last_intent: Intent | None
    is_lead: bool
    tags: list[str]
    summary: str | None
    unread_count: int
    assigned_user_id: uuid.UUID | None
    last_message_at: datetime | None
    created_at: datetime


class MessageOut(BaseModel):
    id: uuid.UUID
    direction: MessageDirection
    origin: MessageOrigin
    body: str
    status: DeliveryStatus
    intent: Intent | None
    ai_confidence: float | None
    author_user_id: uuid.UUID | None
    created_at: datetime


class ConversationUpdate(BaseModel):
    priority: Priority | None = None
    tags: list[str] | None = Field(default=None, max_length=50)
    is_lead: bool | None = None


class SendMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
