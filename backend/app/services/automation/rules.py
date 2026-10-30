import uuid

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings
from app.core.errors import AppError
from app.models.base import utcnow
from app.models.business import AutomationRule
from app.models.enums import RuleScope
from app.models.identity import Organization
from app.schemas.automation import RuleIn
from app.services.audit import record_audit
from app.services.automation.matching import first_match
from app.services.tenancy import TenantContext

_ORDER = (AutomationRule.priority, AutomationRule.created_at, AutomationRule.id)


def _not_found() -> AppError:
    return AppError("AUTOMATION_RULE_NOT_FOUND", "Automation rule not found.", 404)


def _live(organization_id: uuid.UUID) -> tuple[ColumnElement[bool], ...]:
    return (
        AutomationRule.organization_id == organization_id,
        AutomationRule.deleted_at.is_(None),
    )


async def enabled_rules(session: AsyncSession, organization_id: uuid.UUID) -> list[AutomationRule]:
    """The organization's enabled rules in the order they are tried. Creating a rule is capped (see
    AUTOMATION_MAX_RULES), so there are few; the channel is left to the matcher, not the query."""
    result = await session.execute(
        select(AutomationRule)
        .where(*_live(organization_id), AutomationRule.enabled.is_(True))
        .order_by(*_ORDER)
    )
    return list(result.scalars())


async def matching_rule(
    session: AsyncSession,
    organization_id: uuid.UUID,
    scope: RuleScope,
    text: str,
) -> AutomationRule | None:
    """The rule that answers this message instead of the AI, if any."""
    rules = await enabled_rules(session, organization_id)
    return first_match(rules, scope, text)


def validate_texts(data: RuleIn, settings: Settings) -> None:
    """Reply text must fit where it will be sent. The limits are the ones the AI's own replies are
    held to, so a rule can never send something Instagram or the app would refuse."""
    if data.reply_text is not None:
        if (
            data.applies_to is not RuleScope.DM
            and len(data.reply_text) > settings.comment_reply_max_chars
        ):
            raise AppError(
                "AUTOMATION_RULE_INVALID",
                f"A comment reply can be at most {settings.comment_reply_max_chars} characters.",
                422,
            )
        if len(data.reply_text.encode()) > settings.dm_reply_max_bytes:
            raise AppError(
                "AUTOMATION_RULE_INVALID",
                f"A direct message can be at most {settings.dm_reply_max_bytes} bytes "
                "(about that many characters in English, fewer in other scripts).",
                422,
            )
    if data.private_reply_text is not None and (
        len(data.private_reply_text.encode()) > settings.dm_reply_max_bytes
    ):
        raise AppError(
            "AUTOMATION_RULE_INVALID",
            f"A private message can be at most {settings.dm_reply_max_bytes} bytes.",
            422,
        )


async def _lock_organization(session: AsyncSession, organization_id: uuid.UUID) -> None:
    """Serialise rule writes per organization, so two simultaneous creates cannot both slip
    under the limit and a reorder cannot interleave with an edit."""
    await session.execute(
        select(Organization.id).where(Organization.id == organization_id).with_for_update()
    )


async def list_rules(session: AsyncSession, tenant: TenantContext) -> list[AutomationRule]:
    result = await session.execute(
        select(AutomationRule).where(*_live(tenant.organization_id)).order_by(*_ORDER)
    )
    return list(result.scalars())


async def _get(session: AsyncSession, tenant: TenantContext, rule_id: uuid.UUID) -> AutomationRule:
    rule = (
        await session.execute(
            select(AutomationRule).where(
                *_live(tenant.organization_id), AutomationRule.id == rule_id
            )
        )
    ).scalar_one_or_none()
    if rule is None:
        raise _not_found()
    return rule


def _apply(rule: AutomationRule, data: RuleIn) -> None:
    rule.name = data.name
    rule.enabled = data.enabled
    rule.applies_to = data.applies_to
    rule.keywords = list(data.keywords)
    rule.keyword_match = data.keyword_match
    rule.action = data.action
    rule.reply_text = data.reply_text
    rule.private_reply_text = data.private_reply_text
    rule.handoff_reason = data.handoff_reason


async def create_rule(
    session: AsyncSession, tenant: TenantContext, data: RuleIn, settings: Settings
) -> AutomationRule:
    validate_texts(data, settings)
    await _lock_organization(session, tenant.organization_id)
    count, highest = (
        await session.execute(
            select(func.count(), func.max(AutomationRule.priority)).where(
                *_live(tenant.organization_id)
            )
        )
    ).one()
    if count >= settings.automation_max_rules:
        raise AppError(
            "AUTOMATION_RULE_LIMIT",
            f"You can have at most {settings.automation_max_rules} automation rules.",
            409,
        )
    rule = AutomationRule(
        organization_id=tenant.organization_id,
        priority=0 if highest is None else highest + 1,
    )
    _apply(rule, data)
    session.add(rule)
    await session.flush()
    record_audit(
        session,
        "automation.rule.created",
        tenant.organization_id,
        tenant.user_id,
        {"rule_id": str(rule.id), "action": rule.action.value},
    )
    return rule


async def replace_rule(
    session: AsyncSession,
    tenant: TenantContext,
    rule_id: uuid.UUID,
    data: RuleIn,
    settings: Settings,
) -> AutomationRule:
    validate_texts(data, settings)
    await _lock_organization(session, tenant.organization_id)
    rule = await _get(session, tenant, rule_id)
    _apply(rule, data)
    await session.flush()
    record_audit(
        session,
        "automation.rule.updated",
        tenant.organization_id,
        tenant.user_id,
        {"rule_id": str(rule.id), "action": rule.action.value, "enabled": rule.enabled},
    )
    return rule


async def delete_rule(session: AsyncSession, tenant: TenantContext, rule_id: uuid.UUID) -> None:
    """Soft delete: messages the rule already sent keep pointing at it."""
    await _lock_organization(session, tenant.organization_id)
    rule = await _get(session, tenant, rule_id)
    rule.deleted_at = utcnow()
    record_audit(
        session,
        "automation.rule.deleted",
        tenant.organization_id,
        tenant.user_id,
        {"rule_id": str(rule.id)},
    )


async def reorder_rules(
    session: AsyncSession, tenant: TenantContext, ids: list[uuid.UUID]
) -> list[AutomationRule]:
    """The order is the whole list or nothing: a partial list would silently leave some rules
    ahead of or behind the ones the person arranged."""
    await _lock_organization(session, tenant.organization_id)
    rules = {rule.id: rule for rule in await list_rules(session, tenant)}
    if len(ids) != len(set(ids)) or set(ids) != set(rules):
        raise AppError(
            "AUTOMATION_RULE_ORDER_STALE",
            "The list of rules changed. Reload and arrange them again.",
            409,
        )
    for position, rule_id in enumerate(ids):
        rules[rule_id].priority = position
    await session.flush()
    record_audit(
        session,
        "automation.rule.reordered",
        tenant.organization_id,
        tenant.user_id,
        {"count": len(ids)},
    )
    return [rules[rule_id] for rule_id in ids]


async def preview(
    session: AsyncSession, tenant: TenantContext, scope: RuleScope, text: str
) -> AutomationRule | None:
    return await matching_rule(session, tenant.organization_id, scope, text)
