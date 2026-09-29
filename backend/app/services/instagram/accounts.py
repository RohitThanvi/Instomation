import json
import secrets
import uuid

import structlog
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings
from app.core.errors import AppError
from app.core.rbac import Permission
from app.models.enums import InstagramAccountStatus
from app.models.instagram import InstagramAccount
from app.services.audit import record_audit
from app.services.instagram.client import InstagramApi, InstagramApiError
from app.services.instagram.crypto import TokenCipher
from app.services.tenancy import TenantContext, require_permission

logger = structlog.get_logger(__name__)

_STATE_KEY = "instomation:ig_oauth_state:{state}"
_PROFESSIONAL_TYPES = frozenset({"BUSINESS", "MEDIA_CREATOR"})


def _api_failure(exc: InstagramApiError) -> AppError:
    if exc.is_retryable:
        return AppError(
            "INSTAGRAM_UNAVAILABLE", "Instagram is temporarily unavailable. Try again shortly.", 503
        )
    return AppError(
        "INSTAGRAM_CONNECTION_FAILED", "Instagram rejected the connection request.", 502
    )


async def start_oauth(
    redis: Redis, api: InstagramApi, settings: Settings, tenant: TenantContext
) -> str:
    """Create a single-use, expiring state bound to the initiating user and organization."""
    state = secrets.token_urlsafe(32)
    payload = json.dumps(
        {"organization_id": str(tenant.organization_id), "user_id": str(tenant.user_id)}
    )
    await redis.set(_STATE_KEY.format(state=state), payload, ex=settings.oauth_state_ttl_seconds)
    return api.authorization_url(state)


async def consume_state(redis: Redis, state: str) -> tuple[uuid.UUID, uuid.UUID]:
    raw = await redis.getdel(_STATE_KEY.format(state=state))
    if raw is None:
        raise AppError("INVALID_OAUTH_STATE", "This connection attempt expired. Please retry.", 400)
    data = json.loads(raw)
    return uuid.UUID(data["organization_id"]), uuid.UUID(data["user_id"])


async def complete_oauth(
    session: AsyncSession,
    api: InstagramApi,
    cipher: TokenCipher,
    code: str,
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
) -> InstagramAccount:
    await require_permission(session, user_id, organization_id, Permission.SETTINGS_MANAGE)
    try:
        short = await api.exchange_code(code)
        long_lived = await api.exchange_long_lived(short.access_token)
        profile = await api.get_profile(long_lived.access_token)
    except InstagramApiError as exc:
        raise _api_failure(exc) from exc

    if profile.account_type not in _PROFESSIONAL_TYPES:
        raise AppError(
            "INSTAGRAM_ACCOUNT_NOT_PROFESSIONAL",
            "Only Instagram Business or Creator accounts can be connected.",
            400,
        )

    account = (
        await session.execute(
            select(InstagramAccount).where(InstagramAccount.external_account_id == profile.user_id)
        )
    ).scalar_one_or_none()
    if account is not None and account.organization_id != organization_id:
        raise AppError(
            "ACCOUNT_ALREADY_CONNECTED",
            "This Instagram account is already connected to another workspace.",
            409,
        )
    if account is None:
        account = InstagramAccount(
            organization_id=organization_id,
            external_account_id=profile.user_id,
            granted_permissions=[],
        )
        session.add(account)

    account.username = profile.username
    account.status = InstagramAccountStatus.ACTIVE
    account.access_token_encrypted = cipher.encrypt(long_lived.access_token)
    account.token_expires_at = long_lived.expires_at
    account.granted_permissions = short.permissions
    account.deleted_at = None
    try:
        account.webhook_subscribed = await _subscribe(api, long_lived.access_token)
        await session.flush()
    except IntegrityError as exc:
        raise AppError(
            "ACCOUNT_ALREADY_CONNECTED",
            "This Instagram account is already connected to another workspace.",
            409,
        ) from exc
    record_audit(
        session,
        "instagram.connected",
        organization_id,
        user_id,
        {"instagram_account_id": str(account.id), "webhook_subscribed": account.webhook_subscribed},
    )
    return account


async def _subscribe(api: InstagramApi, token: str) -> bool:
    """Webhook subscription failure must not block the connection, but is never hidden."""
    try:
        await api.subscribe_webhooks(token)
    except InstagramApiError:
        logger.warning("webhook_subscription_failed")
        return False
    return True


async def disconnect_account(
    session: AsyncSession, tenant: TenantContext, account_id: uuid.UUID
) -> None:
    """Revoke our access: wipe the token and stop processing. Conversation history is retained
    until the owner deletes it (see docs/SECURITY.md), and the row is kept so reconnecting
    restores the same account instead of orphaning that history."""
    account = (
        await session.execute(
            select(InstagramAccount).where(
                InstagramAccount.id == account_id,
                InstagramAccount.organization_id == tenant.organization_id,
                InstagramAccount.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if account is None:
        raise AppError("INSTAGRAM_ACCOUNT_NOT_FOUND", "Instagram account not found.", 404)
    account.status = InstagramAccountStatus.DISCONNECTED
    account.access_token_encrypted = b""
    account.token_expires_at = None
    account.webhook_subscribed = False
    record_audit(
        session,
        "instagram.disconnected",
        tenant.organization_id,
        tenant.user_id,
        {"instagram_account_id": str(account.id)},
    )
