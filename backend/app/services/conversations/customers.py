import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instagram import Customer


async def get_or_create_customer(
    session: AsyncSession,
    organization_id: uuid.UUID,
    instagram_account_id: uuid.UUID,
    external_user_id: str,
    username: str | None = None,
) -> Customer:
    """Race-safe upsert: two concurrent webhook deliveries for a new customer never collide."""
    await session.execute(
        insert(Customer)
        .values(
            organization_id=organization_id,
            instagram_account_id=instagram_account_id,
            external_user_id=external_user_id,
            username=username,
        )
        .on_conflict_do_nothing(
            index_elements=["instagram_account_id", "external_user_id"],
            index_where=Customer.deleted_at.is_(None),
        )
    )
    customer = (
        await session.execute(
            select(Customer).where(
                Customer.instagram_account_id == instagram_account_id,
                Customer.external_user_id == external_user_id,
                Customer.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    if username and customer.username != username:
        customer.username = username
    return customer
