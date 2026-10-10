from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep, require
from app.core.rbac import Permission
from app.schemas.business import (
    AiSettingsOut,
    AiSettingsUpdate,
    BusinessProfileIn,
    BusinessProfileOut,
)
from app.services import business as service
from app.services.tenancy import TenantContext

router = APIRouter(tags=["business"])

SettingsManager = Annotated[TenantContext, Depends(require(Permission.SETTINGS_MANAGE))]


@router.get("/business/profile", response_model=BusinessProfileOut)
async def get_profile(tenant: SettingsManager, session: SessionDep) -> BusinessProfileOut:
    return await service.get_profile(session, tenant)


@router.put("/business/profile", response_model=BusinessProfileOut)
async def replace_profile(
    body: BusinessProfileIn, tenant: SettingsManager, session: SessionDep
) -> BusinessProfileOut:
    return await service.replace_profile(session, tenant, body)


@router.get("/settings/ai", response_model=AiSettingsOut)
async def get_ai_settings(tenant: SettingsManager, session: SessionDep) -> AiSettingsOut:
    return await service.get_ai_settings(session, tenant)


@router.patch("/settings/ai", response_model=AiSettingsOut)
async def update_ai_settings(
    body: AiSettingsUpdate, tenant: SettingsManager, session: SessionDep
) -> AiSettingsOut:
    return await service.update_ai_settings(session, tenant, body)
