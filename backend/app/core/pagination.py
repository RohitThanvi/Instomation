import base64
import binascii
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import Row, Select, literal, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.core.errors import AppError

DEFAULT_LIMIT = 50
MAX_LIMIT = 100


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None


def encode_cursor(created_at: datetime, row_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{row_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        created_raw, id_raw = raw.split("|", 1)
        return datetime.fromisoformat(created_raw), uuid.UUID(id_raw)
    except (binascii.Error, ValueError) as exc:
        raise AppError("INVALID_CURSOR", "The pagination cursor is not valid.", 400) from exc


async def keyset_page(
    session: AsyncSession,
    stmt: Select[Any],
    created_at: InstrumentedAttribute[datetime],
    row_id: InstrumentedAttribute[uuid.UUID],
    key: Callable[[Row[Any]], tuple[datetime, uuid.UUID]],
    cursor: str | None,
    limit: int,
) -> tuple[list[Row[Any]], str | None]:
    """Stable (created_at, id) keyset pagination; never issues an unbounded query."""
    limit = max(1, min(limit, MAX_LIMIT))
    if cursor:
        after_created, after_id = decode_cursor(cursor)
        stmt = stmt.where(
            tuple_(created_at, row_id) > tuple_(literal(after_created), literal(after_id))
        )
    rows = list((await session.execute(stmt.order_by(created_at, row_id).limit(limit + 1))).all())
    if len(rows) <= limit:
        return rows, None
    rows = rows[:limit]
    return rows, encode_cursor(*key(rows[-1]))
