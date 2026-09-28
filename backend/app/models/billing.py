import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantOwned, Timestamps, UUIDPrimaryKey, enum_column
from app.models.enums import BillingInterval, SubscriptionStatus


class Plan(UUIDPrimaryKey, Timestamps, Base):
    """Plan limits live in usage_limits-style rows, never in code."""

    __tablename__ = "plans"

    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")


class PlanLimit(UUIDPrimaryKey, Base):
    __tablename__ = "plan_limits"
    __table_args__ = (UniqueConstraint("plan_id", "metric"),)

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), index=True
    )
    metric: Mapped[str] = mapped_column(String(48))
    limit_value: Mapped[int] = mapped_column(BigInteger)


class Subscription(UUIDPrimaryKey, TenantOwned, Timestamps, Base):
    __tablename__ = "subscriptions"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plans.id"), index=True
    )
    status: Mapped[SubscriptionStatus] = mapped_column(enum_column(SubscriptionStatus), index=True)
    interval: Mapped[BillingInterval] = mapped_column(enum_column(BillingInterval))
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    grace_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider_customer_id: Mapped[str | None] = mapped_column(String(128))
    provider_subscription_id: Mapped[str | None] = mapped_column(String(128), unique=True)


class UsageLimit(UUIDPrimaryKey, TenantOwned, Timestamps, Base):
    """Per-organization override of a plan limit."""

    __tablename__ = "usage_limits"
    __table_args__ = (UniqueConstraint("organization_id", "metric"),)

    metric: Mapped[str] = mapped_column(String(48))
    limit_value: Mapped[int] = mapped_column(BigInteger)


class UsageRecord(UUIDPrimaryKey, TenantOwned, Timestamps, Base):
    __tablename__ = "usage_records"
    __table_args__ = (UniqueConstraint("organization_id", "metric", "period_start"),)

    metric: Mapped[str] = mapped_column(String(48))
    period_start: Mapped[date] = mapped_column(Date)
    quantity: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
