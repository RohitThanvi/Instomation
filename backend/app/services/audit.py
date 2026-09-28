import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ops import AuditLog


def record_audit(
    session: AsyncSession,
    action: str,
    organization_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Stage an audit row in the caller's transaction so it commits atomically with the change.

    Metadata must never contain tokens, keys or personal data.
    """
    session.add(
        AuditLog(
            organization_id=organization_id,
            user_id=user_id,
            action=action,
            metadata_json=metadata or {},
        )
    )
