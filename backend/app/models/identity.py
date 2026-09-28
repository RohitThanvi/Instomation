import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDelete, Timestamps, UUIDPrimaryKey, enum_column
from app.models.enums import AccountType, MemberRole


class User(UUIDPrimaryKey, Timestamps, SoftDelete, Base):
    __tablename__ = "users"

    clerk_user_id: Mapped[str] = mapped_column(String(64), unique=True)
    email: Mapped[str | None] = mapped_column(String(320))
    full_name: Mapped[str | None] = mapped_column(String(200))
    is_platform_admin: Mapped[bool] = mapped_column(default=False, server_default="false")


class Organization(UUIDPrimaryKey, Timestamps, SoftDelete, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200))
    account_type: Mapped[AccountType] = mapped_column(enum_column(AccountType))


class OrganizationMember(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "organization_members"
    __table_args__ = (UniqueConstraint("organization_id", "user_id"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[MemberRole] = mapped_column(enum_column(MemberRole))
