import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import InstagramAccountStatus
from app.services.instagram.capabilities import Feature


class InstagramAccountOut(BaseModel):
    id: uuid.UUID
    username: str
    status: InstagramAccountStatus
    granted_permissions: list[str]
    webhook_subscribed: bool
    token_expires_at: datetime | None


class OAuthStartOut(BaseModel):
    authorization_url: str


class CapabilityOut(BaseModel):
    feature: Feature
    enabled: bool
    reason: str | None
