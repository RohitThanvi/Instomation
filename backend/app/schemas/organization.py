import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AccountType, MemberRole


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    account_type: AccountType


class OrganizationOut(BaseModel):
    id: uuid.UUID
    name: str
    account_type: AccountType
    role: MemberRole


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    membership_id: uuid.UUID
    user_id: uuid.UUID
    email: str | None
    full_name: str | None
    role: MemberRole


class MemberRoleUpdate(BaseModel):
    role: MemberRole
