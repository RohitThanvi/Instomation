import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select

from app.api.deps import SessionDep, require
from app.config.settings import Settings, get_settings
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page, keyset_page
from app.core.rbac import Permission
from app.models.business import KnowledgeEntry
from app.models.enums import KnowledgeKind
from app.schemas.knowledge import EntryCreate, EntryOut, EntryUpdate, SearchHit, SearchIn
from app.services.knowledge import entries as service
from app.services.knowledge.search import search_entries
from app.services.tenancy import TenantContext

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

KnowledgeManager = Annotated[TenantContext, Depends(require(Permission.SETTINGS_MANAGE))]
Cursor = Annotated[str | None, Query(max_length=200)]
Limit = Annotated[int, Query(ge=1, le=MAX_LIMIT)]


def _out(entry: KnowledgeEntry) -> EntryOut:
    return EntryOut(
        id=entry.id,
        kind=entry.kind,
        title=entry.title,
        content=entry.content,
        attributes=entry.attributes,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/entries", response_model=Page[EntryOut])
async def list_entries(
    tenant: KnowledgeManager,
    session: SessionDep,
    cursor: Cursor = None,
    limit: Limit = DEFAULT_LIMIT,
    kind: KnowledgeKind | None = None,
) -> Page[EntryOut]:
    stmt = select(KnowledgeEntry).where(
        KnowledgeEntry.organization_id == tenant.organization_id,
        KnowledgeEntry.deleted_at.is_(None),
    )
    if kind is not None:
        stmt = stmt.where(KnowledgeEntry.kind == kind)
    rows, next_cursor = await keyset_page(
        session,
        stmt,
        KnowledgeEntry.created_at,
        KnowledgeEntry.id,
        lambda row: (row[0].created_at, row[0].id),
        cursor,
        limit,
    )
    return Page[EntryOut](items=[_out(row[0]) for row in rows], next_cursor=next_cursor)


@router.post("/entries", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: EntryCreate, settings: SettingsDep, tenant: KnowledgeManager, session: SessionDep
) -> EntryOut:
    return _out(await service.create_entry(session, settings, tenant, body))


@router.get("/entries/{entry_id}", response_model=EntryOut)
async def get_entry(entry_id: uuid.UUID, tenant: KnowledgeManager, session: SessionDep) -> EntryOut:
    return _out(await service.get_entry(session, tenant, entry_id))


@router.patch("/entries/{entry_id}", response_model=EntryOut)
async def update_entry(
    entry_id: uuid.UUID, body: EntryUpdate, tenant: KnowledgeManager, session: SessionDep
) -> EntryOut:
    return _out(await service.update_entry(session, tenant, entry_id, body))


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: uuid.UUID, tenant: KnowledgeManager, session: SessionDep
) -> Response:
    await service.delete_entry(session, tenant, entry_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/search", response_model=list[SearchHit])
async def search(
    body: SearchIn, settings: SettingsDep, tenant: KnowledgeManager, session: SessionDep
) -> list[SearchHit]:
    """What the assistant would retrieve for this text; lets owners test their knowledge base."""
    hits = await search_entries(session, settings, tenant.organization_id, body.query, body.limit)
    return [SearchHit(entry=_out(hit.entry), score=hit.score) for hit in hits]
