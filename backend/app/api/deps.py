import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings, get_settings
from app.core.errors import AppError
from app.core.rate_limit import (
    WINDOW_SECONDS,
    RateLimitRule,
    rate_limited_error,
    retry_after_if_limited,
)
from app.core.rbac import Permission, has_permission
from app.core.security import ClerkTokenVerifier, Identity, unauthenticated
from app.db.deps import get_session
from app.models.identity import User
from app.services.tenancy import TenantContext, get_or_create_user, resolve_tenant

_bearer = HTTPBearer(auto_error=False)
ORGANIZATION_HEADER = "X-Organization-ID"

# scope="function": commit/rollback run before the response is sent, so a failed commit
# reaches the client as an error instead of a false success.
SessionDep = Annotated[AsyncSession, Depends(get_session, scope="function")]


def get_verifier(request: Request) -> ClerkTokenVerifier:
    verifier: ClerkTokenVerifier = request.app.state.token_verifier
    return verifier


async def get_identity(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[ClerkTokenVerifier, Depends(get_verifier)],
) -> Identity:
    if credentials is None:
        raise unauthenticated()
    return await verifier.verify(credentials.credentials)


CurrentIdentity = Annotated[Identity, Depends(get_identity)]


async def get_current_user(
    request: Request,
    identity: CurrentIdentity,
    session: SessionDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    user = await get_or_create_user(session, identity.clerk_user_id)
    retry_after = await retry_after_if_limited(
        request.app.state,
        RateLimitRule(
            "http_user", str(user.id), settings.rate_limit_per_minute_per_user, WINDOW_SECONDS
        ),
    )
    if retry_after is not None:
        raise rate_limited_error(retry_after)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_tenant(
    user: CurrentUser,
    session: SessionDep,
    organization_id: Annotated[str | None, Header(alias=ORGANIZATION_HEADER)] = None,
) -> TenantContext:
    requested: uuid.UUID | None = None
    if organization_id:
        try:
            requested = uuid.UUID(organization_id)
        except ValueError as exc:
            raise AppError("VALIDATION_ERROR", "Invalid organization identifier.", 400) from exc
    return await resolve_tenant(session, user, requested)


Tenant = Annotated[TenantContext, Depends(get_tenant)]


def require(permission: Permission) -> Callable[[TenantContext], Awaitable[TenantContext]]:
    """Route dependency enforcing a permission for the caller's role in the resolved tenant."""

    async def checker(tenant: Tenant) -> TenantContext:
        if not has_permission(tenant.role, permission):
            raise AppError("PERMISSION_DENIED", "You do not have permission to do this.", 403)
        return tenant

    return checker
