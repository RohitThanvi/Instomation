import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import ColumnElement, Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.core.errors import AppError
from app.models.enums import (
    ConversationState,
    DeliveryStatus,
    HandoffReason,
    MessageDirection,
    MessageOrigin,
)
from app.models.instagram import Conversation, Message
from app.models.ops import AiUsage, HumanHandoff
from app.schemas.analytics import (
    AnalyticsOverview,
    AutomationStats,
    ConversationStats,
    DailyMessages,
    DailyUsage,
    DateRange,
    MessageStats,
    ModerationStats,
    UsageByModel,
    UsageByPurpose,
    UsageLine,
    UsageReport,
)

MAX_RANGE_DAYS = 366
DEFAULT_RANGE_DAYS = 30


def resolve_range(start: date | None, end: date | None, *, today: date | None = None) -> DateRange:
    """Inclusive UTC date range, defaulting to the last 30 days ending today."""
    end = end or today or datetime.now(UTC).date()
    start = start or end - timedelta(days=DEFAULT_RANGE_DAYS - 1)
    if start > end:
        raise AppError("INVALID_RANGE", "The start date must not be after the end date.", 422)
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise AppError("INVALID_RANGE", f"The range may cover at most {MAX_RANGE_DAYS} days.", 422)
    return DateRange(start=start, end=end)


def _bounds(rng: DateRange) -> tuple[datetime, datetime]:
    """[start 00:00, day after end 00:00) in UTC, so the end date is included."""
    return (
        datetime.combine(rng.start, datetime.min.time(), tzinfo=UTC),
        datetime.combine(rng.end + timedelta(days=1), datetime.min.time(), tzinfo=UTC),
    )


def _utc_day(column: InstrumentedAttribute[datetime]) -> ColumnElement[date]:
    return cast(func.timezone("UTC", column), Date)


def _days(rng: DateRange) -> list[date]:
    return [rng.start + timedelta(days=i) for i in range((rng.end - rng.start).days + 1)]


async def overview(
    session: AsyncSession, organization_id: uuid.UUID, rng: DateRange
) -> AnalyticsOverview:
    lo, hi = _bounds(rng)
    in_range = (
        Message.organization_id == organization_id,
        Message.created_at >= lo,
        Message.created_at < hi,
    )
    not_note = Message.origin != MessageOrigin.INTERNAL_NOTE

    # ---- conversations
    live = (Conversation.organization_id == organization_id, Conversation.deleted_at.is_(None))
    new_total, new_leads = (
        await session.execute(
            select(func.count(), func.count().filter(Conversation.is_lead.is_(True))).where(
                *live, Conversation.created_at >= lo, Conversation.created_at < hi
            )
        )
    ).one()
    by_state = dict.fromkeys(ConversationState, 0)
    for state, total in (
        await session.execute(
            select(Conversation.state, func.count()).where(*live).group_by(Conversation.state)
        )
    ).all():
        by_state[state] = total

    # ---- messages
    direction_origin = {
        (direction, origin): total
        for direction, origin, total in (
            await session.execute(
                select(Message.direction, Message.origin, func.count())
                .where(*in_range, not_note)
                .group_by(Message.direction, Message.origin)
            )
        ).all()
    }
    failed = await session.scalar(
        select(func.count()).where(
            *in_range,
            Message.direction == MessageDirection.OUTBOUND,
            Message.status == DeliveryStatus.FAILED,
        )
    )
    ai_sent = await session.scalar(
        select(func.count()).where(
            *in_range, Message.origin == MessageOrigin.AI, Message.status == DeliveryStatus.SENT
        )
    )

    # ---- handoffs
    handoffs_by_reason = dict.fromkeys(HandoffReason, 0)
    for reason, total in (
        await session.execute(
            select(HumanHandoff.reason, func.count())
            .where(
                HumanHandoff.organization_id == organization_id,
                HumanHandoff.created_at >= lo,
                HumanHandoff.created_at < hi,
            )
            .group_by(HumanHandoff.reason)
        )
    ).all():
        handoffs_by_reason[reason] = total
    resolved = await session.scalar(
        select(func.count()).where(
            HumanHandoff.organization_id == organization_id,
            HumanHandoff.resolved_at >= lo,
            HumanHandoff.resolved_at < hi,
        )
    )

    # ---- moderation (customer messages only)
    action_col = Message.moderation["action"].as_string()
    category_col = Message.moderation["category"].as_string()
    actions: dict[str, int] = {}
    blocked_by_category: dict[str, int] = {}
    for action, category, total in (
        await session.execute(
            select(action_col, category_col, func.count())
            .where(
                *in_range, Message.origin == MessageOrigin.CUSTOMER, Message.moderation.is_not(None)
            )
            .group_by(action_col, category_col)
        )
    ).all():
        actions[action] = actions.get(action, 0) + total
        if action == "block":
            blocked_by_category[category] = total

    # ---- daily series (zero-filled so a chart has no gaps)
    day = _utc_day(Message.created_at)
    per_day: dict[date, dict[MessageDirection, int]] = {}
    for d, direction, total in (
        await session.execute(
            select(day, Message.direction, func.count())
            .where(*in_range, not_note)
            .group_by(day, Message.direction)
        )
    ).all():
        per_day.setdefault(d, {})[direction] = total

    inbound, outbound = MessageDirection.INBOUND, MessageDirection.OUTBOUND
    return AnalyticsOverview(
        range=rng,
        conversations=ConversationStats(new=new_total, new_leads=new_leads, by_state=by_state),
        messages=MessageStats(
            inbound=sum(n for (d, _), n in direction_origin.items() if d is inbound),
            outbound_ai=direction_origin.get((outbound, MessageOrigin.AI), 0),
            outbound_human=direction_origin.get((outbound, MessageOrigin.HUMAN), 0),
            outbound_failed=failed or 0,
        ),
        automation=AutomationStats(
            ai_replies_sent=ai_sent or 0,
            handoffs_opened=sum(handoffs_by_reason.values()),
            handoffs_resolved=resolved or 0,
            handoffs_by_reason=handoffs_by_reason,
        ),
        moderation=ModerationStats(
            allowed=actions.get("allow", 0),
            blocked=actions.get("block", 0),
            escalated=actions.get("escalate", 0),
            blocked_by_category=blocked_by_category,
        ),
        daily=[
            DailyMessages(
                date=d,
                inbound=per_day.get(d, {}).get(inbound, 0),
                outbound=per_day.get(d, {}).get(outbound, 0),
            )
            for d in _days(rng)
        ],
    )


async def usage_report(
    session: AsyncSession, organization_id: uuid.UUID, rng: DateRange
) -> UsageReport:
    lo, hi = _bounds(rng)
    where = (
        AiUsage.organization_id == organization_id,
        AiUsage.created_at >= lo,
        AiUsage.created_at < hi,
    )
    requests = func.count()
    input_tokens = func.coalesce(func.sum(AiUsage.input_tokens), 0)
    output_tokens = func.coalesce(func.sum(AiUsage.output_tokens), 0)
    cost = func.coalesce(func.sum(AiUsage.estimated_cost), Decimal(0))

    totals = (
        await session.execute(select(requests, input_tokens, output_tokens, cost).where(*where))
    ).one()
    failed = await session.scalar(select(func.count()).where(*where, AiUsage.status != "success"))
    unpriced = await session.scalar(
        select(func.count()).where(
            *where, AiUsage.estimated_cost == 0, AiUsage.input_tokens + AiUsage.output_tokens > 0
        )
    )
    latency = await session.scalar(select(func.avg(AiUsage.latency_ms)).where(*where))

    by_purpose = [
        UsageByPurpose(
            purpose=purpose,
            requests=n,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            estimated_cost=spent,
        )
        for purpose, n, tokens_in, tokens_out, spent in (
            await session.execute(
                select(AiUsage.purpose, requests, input_tokens, output_tokens, cost)
                .where(*where)
                .group_by(AiUsage.purpose)
                .order_by(cost.desc(), AiUsage.purpose)
            )
        ).all()
    ]
    by_model = [
        UsageByModel(
            provider=provider,
            model=model,
            requests=n,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            estimated_cost=spent,
        )
        for provider, model, n, tokens_in, tokens_out, spent in (
            await session.execute(
                select(AiUsage.provider, AiUsage.model, requests, input_tokens, output_tokens, cost)
                .where(*where)
                .group_by(AiUsage.provider, AiUsage.model)
                .order_by(cost.desc(), AiUsage.provider, AiUsage.model)
            )
        ).all()
    ]
    day = _utc_day(AiUsage.created_at)
    per_day = {
        d: (n, spent)
        for d, n, spent in (
            await session.execute(select(day, requests, cost).where(*where).group_by(day))
        ).all()
    }
    return UsageReport(
        range=rng,
        totals=UsageLine(
            requests=totals[0],
            input_tokens=totals[1],
            output_tokens=totals[2],
            estimated_cost=totals[3],
        ),
        failed_requests=failed or 0,
        unpriced_requests=unpriced or 0,
        average_latency_ms=None if latency is None else round(float(latency)),
        by_purpose=by_purpose,
        by_model=by_model,
        daily=[
            DailyUsage(
                date=d,
                requests=per_day.get(d, (0, Decimal(0)))[0],
                estimated_cost=per_day.get(d, (0, Decimal(0)))[1],
            )
            for d in _days(rng)
        ],
    )
