import { describe, expect, it, vi } from 'vitest'
import {
  analyticsOverviewSchema,
  DASHBOARD_RANGES,
  fetchAnalyticsOverview,
  rangeQuery,
} from './analytics'
import type { ApiClient } from './client'
import { ANALYTICS_OVERVIEW } from '@/test/fixtures'

describe('rangeQuery', () => {
  const now = new Date('2026-10-14T09:00:00Z')

  it.each([
    ['7d', '2026-10-08'],
    ['30d', '2026-09-15'],
    ['90d', '2026-07-17'],
  ] as const)('%s ends today and starts %s, inclusive of both days', (range, from) => {
    expect(rangeQuery(range, now)).toEqual({ from, to: '2026-10-14' })
  })

  it('uses the UTC day, not the viewer’s local day', () => {
    // 23:30 on the 13th in New York is already the 14th in UTC.
    expect(rangeQuery('7d', new Date('2026-10-13T23:30:00-04:00')).to).toBe('2026-10-14')
    expect(rangeQuery('7d', new Date('2026-10-14T00:30:00+09:00')).to).toBe('2026-10-13')
  })

  it('crosses month and year boundaries', () => {
    expect(rangeQuery('7d', new Date('2027-01-03T12:00:00Z'))).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    })
  })

  it('spans exactly the number of days named', () => {
    for (const range of DASHBOARD_RANGES) {
      const { from, to } = rangeQuery(range, now)
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1
      expect(days).toBe(Number.parseInt(range, 10))
    }
  })
})

describe('fetchAnalyticsOverview', () => {
  it('requests the overview for the period and validates it with the contract schema', async () => {
    const request = vi.fn().mockResolvedValue(ANALYTICS_OVERVIEW)
    const client: ApiClient = { request }
    const signal = new AbortController().signal
    await fetchAnalyticsOverview(client, '7d', signal)
    expect(request).toHaveBeenCalledWith({
      path: '/api/v1/analytics/overview',
      schema: analyticsOverviewSchema,
      query: rangeQuery('7d'),
      signal,
    })
  })
})

describe('analyticsOverviewSchema', () => {
  it('accepts a well-formed overview', () => {
    expect(analyticsOverviewSchema.parse(ANALYTICS_OVERVIEW)).toEqual(ANALYTICS_OVERVIEW)
  })

  it.each([
    ['a negative count', { messages: { ...ANALYTICS_OVERVIEW.messages, inbound: -1 } }],
    ['a fractional count', { conversations: { ...ANALYTICS_OVERVIEW.conversations, new: 1.5 } }],
    [
      'a missing conversation state',
      {
        conversations: {
          ...ANALYTICS_OVERVIEW.conversations,
          by_state: { ai_active: 1, human_required: 1, human_active: 1 },
        },
      },
    ],
    ['a malformed range date', { range: { start: 'yesterday', end: '2026-09-03' } }],
    ['a malformed daily date', { daily: [{ date: '09/01', inbound: 1, outbound: 1 }] }],
  ])('rejects %s', (_label, patch) => {
    expect(analyticsOverviewSchema.safeParse({ ...ANALYTICS_OVERVIEW, ...patch }).success).toBe(
      false,
    )
  })

  it('rejects the shape the UI originally guessed before the endpoint existed', () => {
    const guessed = { range: '30d', totals: {}, messages_over_time: [], conversations_by_state: {} }
    expect(analyticsOverviewSchema.safeParse(guessed).success).toBe(false)
  })
})
