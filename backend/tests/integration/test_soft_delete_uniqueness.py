"""Regression: a soft-deleted customer/conversation must not block re-creating the same one."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.base import utcnow
from app.models.enums import AccountType
from app.models.identity import Organization
from app.models.instagram import Customer, InstagramAccount, InstagramAccountStatus


async def test_soft_deleted_customer_does_not_block_reinsert(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        org = Organization(name="T", account_type=AccountType.CREATOR)
        session.add(org)
        await session.flush()
        account = InstagramAccount(
            organization_id=org.id,
            external_account_id=f"ig-{uuid.uuid4().hex[:10]}",
            username="acme",
            status=InstagramAccountStatus.ACTIVE,
            access_token_encrypted=b"",
            granted_permissions=[],
        )
        session.add(account)
        await session.flush()

        first = Customer(
            organization_id=org.id,
            instagram_account_id=account.id,
            external_user_id="ext-1",
        )
        session.add(first)
        await session.commit()

        first.deleted_at = utcnow()
        await session.commit()

        second = Customer(
            organization_id=org.id,
            instagram_account_id=account.id,
            external_user_id="ext-1",
        )
        session.add(second)
        await session.commit()
        assert second.id != first.id

        # Clean up: this deliberately leaves a duplicate (org_id, external_user_id) pair across a
        # soft-deleted and an active row, which only the partial unique index (not a plain one)
        # allows. Removing it keeps the database compatible with a downgrade to a prior migration.
        await session.delete(org)  # cascades to the account, customers and everything else
        await session.commit()
