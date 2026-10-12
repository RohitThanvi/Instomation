from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import SessionDep, require
from app.core.rbac import Permission
from app.schemas.analytics import AnalyticsOverview, UsageReport
from app.services import analytics as service
from app.services.tenancy import TenantContext

router = APIRouter(tags=["analytics"])

Viewer = Annotated[TenantContext, Depends(require(Permission.ANALYTICS_VIEW))]
Manager = Annotated[TenantContext, Depends(require(Permission.SETTINGS_MANAGE))]
Start = Annotated[
    date | None, Query(alias="from", description="First day (UTC), default 29 days before `to`")
]
End = Annotated[
    date | None, Query(alias="to", description="Last day (UTC, inclusive), default today")
]


@router.get("/analytics/overview", response_model=AnalyticsOverview)
async def analytics_overview(
    tenant: Viewer, session: SessionDep, start: Start = None, end: End = None
) -> AnalyticsOverview:
    rng = service.resolve_range(start, end)
    return await service.overview(session, tenant.organization_id, rng)


@router.get("/usage", response_model=UsageReport)
async def usage(
    tenant: Manager, session: SessionDep, start: Start = None, end: End = None
) -> UsageReport:
    """AI usage and estimated cost. Owner/admin only: costs are not for every member."""
    rng = service.resolve_range(start, end)
    return await service.usage_report(session, tenant.organization_id, rng)
