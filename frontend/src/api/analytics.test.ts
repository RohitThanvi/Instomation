import { describe, expect, it, vi } from 'vitest'
import { dashboardOverviewSchema, fetchDashboardOverview } from './analytics'
import type { ApiClient } from './client'
import { isNotYetAvailable } from './unavailable'
import { DASHBOARD_OVERVIEW } from '@/test/fixtures'

describe('fetchDashboardOverview', () => {
  it('rejects as "not yet available" without touching the network', async () => {
    const client: ApiClient = { request: vi.fn() }
    const error = await fetchDashboardOverview(client, '30d').catch((e: unknown) => e)
    expect(isNotYetAvailable(error)).toBe(true)
    expect(client.request).not.toHaveBeenCalled()
  })
})

describe('dashboardOverviewSchema', () => {
  it('accepts a well-formed overview', () => {
    expect(dashboardOverviewSchema.parse(DASHBOARD_OVERVIEW)).toEqual(DASHBOARD_OVERVIEW)
  })

  it.each([
    [
      'an automation rate above 100%',
      { totals: { ...DASHBOARD_OVERVIEW.totals, automation_rate: 1.2 } },
    ],
    ['a negative count', { totals: { ...DASHBOARD_OVERVIEW.totals, leads_captured: -1 } }],
    ['a fractional count', { totals: { ...DASHBOARD_OVERVIEW.totals, messages_received: 1.5 } }],
    ['an unknown range', { range: '1y' }],
    [
      'a malformed date',
      { messages_over_time: [{ date: 'yesterday', received: 1, ai_replies: 1, human_replies: 0 }] },
    ],
  ])('rejects %s', (_label, patch) => {
    expect(dashboardOverviewSchema.safeParse({ ...DASHBOARD_OVERVIEW, ...patch }).success).toBe(
      false,
    )
  })
})
