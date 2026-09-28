import uuid
from typing import Annotated
from urllib.parse import urlencode

import structlog
from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from redis.asyncio import Redis
from sqlalchemy import select

from app.api.deps import SessionDep, Tenant, require
from app.config.settings import Settings, get_settings
from app.core.errors import AppError
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page, keyset_page
from app.core.rbac import Permission
from app.models.instagram import InstagramAccount
from app.schemas.instagram import CapabilityOut, InstagramAccountOut, OAuthStartOut
from app.services.instagram import accounts as service
from app.services.instagram.capabilities import Capabilities
from app.services.instagram.client import InstagramApi
from app.services.instagram.crypto import TokenCipher
from app.services.tenancy import TenantContext

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/instagram", tags=["instagram"])

Cursor = Annotated[str | None, Query(max_length=200)]
Limit = Annotated[int, Query(ge=1, le=MAX_LIMIT)]
SettingsManager = Annotated[TenantContext, Depends(require(Permission.SETTINGS_MANAGE))]


def _api(request: Request) -> InstagramApi:
    api: InstagramApi = request.app.state.instagram_api
    return api


def _redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


def _cipher(request: Request) -> TokenCipher:
    cipher: TokenCipher = request.app.state.token_cipher
    return cipher


@router.get("/capabilities", response_model=list[CapabilityOut])
async def capabilities(
    _: Tenant, settings: Annotated[Settings, Depends(get_settings)]
) -> list[CapabilityOut]:
    return [
        CapabilityOut(feature=c.feature, enabled=c.enabled, reason=c.reason)
        for c in Capabilities(settings).all()
    ]


@router.post("/oauth/start", response_model=OAuthStartOut)
async def oauth_start(
    request: Request,
    tenant: SettingsManager,
    settings: Annotated[Settings, Depends(get_settings)],
) -> OAuthStartOut:
    url = await service.start_oauth(_redis(request), _api(request), settings, tenant)
    return OAuthStartOut(authorization_url=url)


@router.get("/oauth/callback", include_in_schema=False)
async def oauth_callback(
    request: Request,
    session: SessionDep,
    settings: Annotated[Settings, Depends(get_settings)],
    state: Annotated[str | None, Query(max_length=200)] = None,
    code: Annotated[str | None, Query(max_length=2000)] = None,
    error: Annotated[str | None, Query(max_length=100)] = None,
) -> RedirectResponse:
    """Browser redirect target from Meta: unauthenticated by design, protected by the state."""

    def back(**params: str) -> RedirectResponse:
        base = settings.frontend_base_url.rstrip("/") + settings.oauth_result_path
        return RedirectResponse(
            f"{base}?{urlencode(params)}", status_code=status.HTTP_303_SEE_OTHER
        )

    if not state:
        return back(status="error", reason="INVALID_OAUTH_STATE")
    try:
        organization_id, user_id = await service.consume_state(_redis(request), state)
        if error or not code:
            return back(status="error", reason="AUTHORIZATION_DENIED")
        await service.complete_oauth(
            session, _api(request), _cipher(request), code, organization_id, user_id
        )
    except AppError as exc:
        await session.rollback()
        return back(status="error", reason=exc.code)
    return back(status="connected")


@router.get("/accounts", response_model=Page[InstagramAccountOut])
async def list_accounts(
    tenant: Tenant, session: SessionDep, cursor: Cursor = None, limit: Limit = DEFAULT_LIMIT
) -> Page[InstagramAccountOut]:
    stmt = select(InstagramAccount).where(
        InstagramAccount.organization_id == tenant.organization_id,
        InstagramAccount.deleted_at.is_(None),
    )
    rows, next_cursor = await keyset_page(
        session,
        stmt,
        InstagramAccount.created_at,
        InstagramAccount.id,
        lambda row: (row[0].created_at, row[0].id),
        cursor,
        limit,
    )
    items = [
        InstagramAccountOut(
            id=a.id,
            username=a.username,
            status=a.status,
            granted_permissions=list(a.granted_permissions),
            webhook_subscribed=a.webhook_subscribed,
            token_expires_at=a.token_expires_at,
        )
        for (a,) in rows
    ]
    return Page[InstagramAccountOut](items=items, next_cursor=next_cursor)


@router.delete(
    "/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
async def disconnect(account_id: uuid.UUID, tenant: SettingsManager, session: SessionDep) -> None:
    await service.disconnect_account(session, tenant, account_id)
