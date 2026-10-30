import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import SessionDep, require
from app.config.settings import Settings, get_settings
from app.core.pagination import Page
from app.core.rbac import Permission
from app.schemas.automation import PreviewIn, PreviewOut, RuleIn, RuleOrder, RuleOut
from app.services.automation import rules as service
from app.services.tenancy import TenantContext

router = APIRouter(prefix="/automations", tags=["automations"])

Automator = Annotated[TenantContext, Depends(require(Permission.AUTOMATION_MANAGE))]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _out(rule: object) -> RuleOut:
    return RuleOut.model_validate(rule)


@router.get("", response_model=Page[RuleOut])
async def list_rules(tenant: Automator, session: SessionDep) -> Page[RuleOut]:
    """Every rule, in the order they are tried. An organization has few (see AUTOMATION_MAX_RULES),
    so this is one page."""
    return Page(items=[_out(rule) for rule in await service.list_rules(session, tenant)])


@router.post("", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: RuleIn, tenant: Automator, session: SessionDep, settings: SettingsDep
) -> RuleOut:
    return _out(await service.create_rule(session, tenant, body, settings))


# Declared before "/{rule_id}" so "order" and "preview" are not read as ids.
@router.put("/order", response_model=Page[RuleOut])
async def reorder_rules(body: RuleOrder, tenant: Automator, session: SessionDep) -> Page[RuleOut]:
    rules = await service.reorder_rules(session, tenant, body.ids)
    return Page(items=[_out(rule) for rule in rules])


@router.post("/preview", response_model=PreviewOut)
async def preview(body: PreviewIn, tenant: Automator, session: SessionDep) -> PreviewOut:
    rule = await service.preview(session, tenant, body.scope, body.text)
    return PreviewOut(rule=None if rule is None else _out(rule))


@router.put("/{rule_id}", response_model=RuleOut)
async def replace_rule(
    rule_id: uuid.UUID,
    body: RuleIn,
    tenant: Automator,
    session: SessionDep,
    settings: SettingsDep,
) -> RuleOut:
    return _out(await service.replace_rule(session, tenant, rule_id, body, settings))


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: uuid.UUID, tenant: Automator, session: SessionDep) -> Response:
    await service.delete_rule(session, tenant, rule_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
