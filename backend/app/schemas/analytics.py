from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from app.models.enums import ConversationState, HandoffReason


class DateRange(BaseModel):
    start: date
    end: date  # inclusive; days are UTC days


class ConversationStats(BaseModel):
    new: int
    new_leads: int
    by_state: dict[ConversationState, int]  # right now, not limited to the range


class MessageStats(BaseModel):
    inbound: int
    outbound_ai: int
    outbound_human: int
    outbound_failed: int


class AutomationStats(BaseModel):
    ai_replies_sent: int
    handoffs_opened: int
    handoffs_resolved: int
    handoffs_by_reason: dict[HandoffReason, int]


class ModerationStats(BaseModel):
    allowed: int
    blocked: int
    escalated: int
    blocked_by_category: dict[str, int]


class DailyMessages(BaseModel):
    date: date
    inbound: int
    outbound: int


class AnalyticsOverview(BaseModel):
    range: DateRange
    conversations: ConversationStats
    messages: MessageStats
    automation: AutomationStats
    moderation: ModerationStats
    daily: list[DailyMessages]


class UsageLine(BaseModel):
    requests: int
    input_tokens: int
    output_tokens: int
    estimated_cost: Decimal


class UsageByPurpose(UsageLine):
    purpose: str


class UsageByModel(UsageLine):
    provider: str
    model: str


class DailyUsage(BaseModel):
    date: date
    requests: int
    estimated_cost: Decimal


class UsageReport(BaseModel):
    range: DateRange
    totals: UsageLine
    failed_requests: int
    # Requests that used tokens but have no price on file (unknown model), so `estimated_cost`
    # understates real spend by their share. Zero means every request was priced.
    unpriced_requests: int
    average_latency_ms: int | None
    by_purpose: list[UsageByPurpose]
    by_model: list[UsageByModel]
    daily: list[DailyUsage]
