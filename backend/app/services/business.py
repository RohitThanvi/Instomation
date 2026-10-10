import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import AiSettings, BusinessProfile
from app.schemas.business import (
    AiSettingsOut,
    AiSettingsUpdate,
    BusinessProfileIn,
    BusinessProfileOut,
)
from app.services.audit import record_audit
from app.services.tenancy import TenantContext

_PROFILE_FIELDS = tuple(BusinessProfileIn.model_fields)


async def _row[T: (BusinessProfile, AiSettings)](
    session: AsyncSession, model: type[T], organization_id: uuid.UUID, *, create: bool
) -> T | None:
    """The organization's single settings row. Creation is insert-or-skip on the unique
    organization_id, so two simultaneous first saves cannot fail or create two rows."""
    if create:
        await session.execute(
            insert(model)
            .values(organization_id=organization_id)
            .on_conflict_do_nothing(index_elements=["organization_id"])
        )
    return (
        await session.execute(select(model).where(model.organization_id == organization_id))
    ).scalar_one_or_none()


def _profile_out(row: BusinessProfile | None) -> BusinessProfileOut:
    defaults = BusinessProfileIn()
    source: Any = row if row is not None else defaults
    return BusinessProfileOut(
        **{name: getattr(source, name) for name in BusinessProfileOut.model_fields}
    )


async def get_profile(session: AsyncSession, tenant: TenantContext) -> BusinessProfileOut:
    return _profile_out(await _row(session, BusinessProfile, tenant.organization_id, create=False))


async def replace_profile(
    session: AsyncSession, tenant: TenantContext, data: BusinessProfileIn
) -> BusinessProfileOut:
    row = await _row(session, BusinessProfile, tenant.organization_id, create=True)
    assert row is not None
    changed = [name for name in _PROFILE_FIELDS if getattr(row, name) != getattr(data, name)]
    for name in changed:
        setattr(row, name, getattr(data, name))
    await session.flush()
    if changed:  # field names only: the text itself never goes into the audit log
        record_audit(
            session,
            "business.profile.updated",
            tenant.organization_id,
            tenant.user_id,
            {"fields": changed},
        )
    return _profile_out(row)


def _ai_out(row: AiSettings | None) -> AiSettingsOut:
    values = {name: getattr(row, name, None) for name in AiSettingsOut.model_fields}
    if row is None:  # column defaults, so an organization that never saved sees what applies
        values = {name: column.default.arg for name, column in _ai_columns().items()}
    return AiSettingsOut(**values)


def _ai_columns() -> dict[str, Any]:
    return {name: AiSettings.__table__.c[name] for name in AiSettingsOut.model_fields}


async def get_ai_settings(session: AsyncSession, tenant: TenantContext) -> AiSettingsOut:
    return _ai_out(await _row(session, AiSettings, tenant.organization_id, create=False))


async def update_ai_settings(
    session: AsyncSession, tenant: TenantContext, data: AiSettingsUpdate
) -> AiSettingsOut:
    row = await _row(session, AiSettings, tenant.organization_id, create=True)
    assert row is not None
    changes = {
        name: getattr(data, name)
        for name in data.model_fields_set
        if getattr(data, name) is not None
    }
    changes = {name: value for name, value in changes.items() if getattr(row, name) != value}
    for name, value in changes.items():
        setattr(row, name, value)
    await session.flush()
    if changes:  # numbers and flags only, so values are safe to keep
        record_audit(
            session, "ai.settings.updated", tenant.organization_id, tenant.user_id, changes
        )
    return _ai_out(row)
