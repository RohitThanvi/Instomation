"""Import every model module so Base.metadata is complete for Alembic and tests."""

from app.models import billing, business, identity, instagram, ops
from app.models.base import Base

__all__ = ["Base", "billing", "business", "identity", "instagram", "ops"]
