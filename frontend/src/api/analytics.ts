import { z } from 'zod'
import type { ApiClient } from './client'
import { NotYetAvailableError } from './unavailable'

/**
 * Dashboard analytics. The endpoint does not exist yet, so this module is the UI's typed
 * expectation of it: `fetchDashboardOverview` rejects without touching the network and the
 * dashboard renders a "not yet available" state. When the backend ships, reconcile this
 * schema with the real response and replace the rejection with `client.request`.
 */
export const DASHBOARD_RANGES = ['7d', '30d', '90d'] as const
export const dashboardRangeSchema = z.enum(DASHBOARD_RANGES)
export type DashboardRange = z.infer<typeof dashboardRangeSchema>
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '30d'

const count = z.number().int().nonnegative()

export const dashboardOverviewSchema = z.object({
  range: dashboardRangeSchema,
  totals: z.object({
    messages_received: count,
    ai_replies_sent: count,
    open_conversations: count,
    leads_captured: count,
    /** Share (0 to 1) of conversations handled without a person stepping in. */
    automation_rate: z.number().min(0).max(1),
  }),
  messages_over_time: z.array(
    z.object({
      date: z.string().date(),
      received: count,
      ai_replies: count,
      human_replies: count,
    }),
  ),
  conversations_by_state: z.object({
    ai_active: count,
    human_required: count,
    human_active: count,
    resolved: count,
  }),
})
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>
export type MessagePoint = DashboardOverview['messages_over_time'][number]
export type ConversationStateCounts = DashboardOverview['conversations_by_state']

export function fetchDashboardOverview(
  _client: ApiClient,
  _range: DashboardRange,
  _signal?: AbortSignal,
): Promise<DashboardOverview> {
  return Promise.reject(new NotYetAvailableError('Analytics'))
}
