import { z } from 'zod'
import type { ApiClient } from './client'
import { API_PREFIX } from '@/config/constants'

/** The dashboard's period choices. The API itself takes any `from`/`to` of up to 366 days. */
export const DASHBOARD_RANGES = ['7d', '30d', '90d'] as const
export const dashboardRangeSchema = z.enum(DASHBOARD_RANGES)
export type DashboardRange = z.infer<typeof dashboardRangeSchema>
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '30d'

const RANGE_DAYS: Record<DashboardRange, number> = { '7d': 7, '30d': 30, '90d': 90 }
const DAY_MS = 86_400_000

/**
 * The inclusive UTC day span the API expects (`to` is included, days are UTC days) for a
 * period ending today, so "last 7 days" is today and the six days before it.
 */
export function rangeQuery(range: DashboardRange, now: Date = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const from = new Date(to.getTime() - (RANGE_DAYS[range] - 1) * DAY_MS)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

const count = z.number().int().nonnegative()
const isoDate = z.string().date()

/**
 * `GET /api/v1/analytics/overview`, exactly as `backend/app/schemas/analytics.py` serializes it.
 * Only `conversations.by_state` describes the present; everything else covers `range`.
 */
export const analyticsOverviewSchema = z.object({
  range: z.object({ start: isoDate, end: isoDate }),
  conversations: z.object({
    new: count,
    new_leads: count,
    by_state: z.object({
      ai_active: count,
      human_required: count,
      human_active: count,
      resolved: count,
    }),
  }),
  messages: z.object({
    inbound: count,
    outbound_ai: count,
    outbound_human: count,
    outbound_failed: count,
  }),
  automation: z.object({
    ai_replies_sent: count,
    handoffs_opened: count,
    handoffs_resolved: count,
    handoffs_by_reason: z.record(z.string(), count),
  }),
  moderation: z.object({
    allowed: count,
    blocked: count,
    escalated: count,
    blocked_by_category: z.record(z.string(), count),
  }),
  daily: z.array(z.object({ date: isoDate, inbound: count, outbound: count })),
})
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>
export type DailyMessages = AnalyticsOverview['daily'][number]
export type ConversationStateCounts = AnalyticsOverview['conversations']['by_state']

export function fetchAnalyticsOverview(
  client: ApiClient,
  range: DashboardRange,
  signal?: AbortSignal,
) {
  return client.request({
    path: `${API_PREFIX}/analytics/overview`,
    schema: analyticsOverviewSchema,
    query: rangeQuery(range),
    signal,
  })
}
