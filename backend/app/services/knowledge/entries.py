import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings
from app.core.errors import AppError
from app.models.base import utcnow
from app.models.business import KnowledgeEntry
from app.schemas.knowledge import EntryCreate, EntryUpdate
from app.services.audit import record_audit
from app.services.tenancy import TenantContext


def _not_found() -> AppError:
    return AppError("KNOWLEDGE_ENTRY_NOT_FOUND", "Knowledge entry not found.", 404)


async def get_entry(
    session: AsyncSession, tenant: TenantContext, entry_id: uuid.UUID
) -> KnowledgeEntry:
    entry = (
        await session.execute(
            select(KnowledgeEntry).where(
                KnowledgeEntry.id == entry_id,
                KnowledgeEntry.organization_id == tenant.organization_id,
                KnowledgeEntry.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        raise _not_found()
    return entry


async def create_entry(
    session: AsyncSession, settings: Settings, tenant: TenantContext, data: EntryCreate
) -> KnowledgeEntry:
    # Serialize creates per organization so concurrent requests cannot jointly exceed the cap
    # (a plain count-then-insert would let both pass the check). Released at commit/rollback.
    await session.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"knowledge:{tenant.organization_id}", 0)
            )
        )
    )
    active = await session.scalar(
        select(func.count())
        .select_from(KnowledgeEntry)
        .where(
            KnowledgeEntry.organization_id == tenant.organization_id,
            KnowledgeEntry.deleted_at.is_(None),
        )
    )
    if (active or 0) >= settings.knowledge_max_entries:
        raise AppError(
            "KNOWLEDGE_LIMIT_REACHED",
            f"You can keep at most {settings.knowledge_max_entries} knowledge entries.",
            409,
        )
    entry = KnowledgeEntry(
        organization_id=tenant.organization_id,
        kind=data.kind,
        title=data.title,
        content=data.content,
        attributes=data.attributes,
    )
    session.add(entry)
    await session.flush()
    _audit(session, "knowledge.entry.created", tenant, entry)
    return entry


async def update_entry(
    session: AsyncSession, tenant: TenantContext, entry_id: uuid.UUID, data: EntryUpdate
) -> KnowledgeEntry:
    entry = await get_entry(session, tenant, entry_id)
    if data.kind is not None:
        entry.kind = data.kind
    if data.title is not None:
        entry.title = data.title
    if data.content is not None:
        entry.content = data.content
    if data.attributes is not None:
        entry.attributes = data.attributes
    await session.flush()
    await session.refresh(entry)  # updated_at / search_vector are database-computed
    _audit(session, "knowledge.entry.updated", tenant, entry)
    return entry


async def delete_entry(session: AsyncSession, tenant: TenantContext, entry_id: uuid.UUID) -> None:
    entry = await get_entry(session, tenant, entry_id)
    entry.deleted_at = utcnow()
    _audit(session, "knowledge.entry.deleted", tenant, entry)


def _audit(
    session: AsyncSession, action: str, tenant: TenantContext, entry: KnowledgeEntry
) -> None:
    metadata: dict[str, Any] = {"entry_id": str(entry.id), "kind": entry.kind.value}
    record_audit(session, action, tenant.organization_id, tenant.user_id, metadata)
