import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import ConversationState, HandoffReason, HandoffStatus, Priority
from app.schemas.conversations import CustomerOut


class HandoffOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    customer: CustomerOut
    conversation_state: ConversationState
    conversation_priority: Priority
    reason: HandoffReason
    status: HandoffStatus
    assigned_user_id: uuid.UUID | None
    created_at: datetime
    resolved_at: datetime | None


class HandoffCounts(BaseModel):
    open: int
    assigned: int
