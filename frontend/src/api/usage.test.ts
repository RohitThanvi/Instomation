import { describe, expect, it, vi } from 'vitest'
import { DASHBOARD_RANGES } from './analytics'
import { createApiClient } from './client'
import { fetchUsage, usageReportSchema, usdAmountSchema } from './usage'
import { usageReportWire } from '@/test/fixtures'

describe('usd amounts', () => {
  it.each(['0', '0.5', '0.000432', '1234.567890', '12'])('accepts %s', (amount) => {
    expect(usdAmountSchema.safeParse(amount).success).toBe(true)
  })

  it.each(['', '-1', '1e-7', '1E-7', '1,5', ' 1', '1.', '.5', 'abc'])('rejects %j', (amount) => {
    expect(usdAmountSchema.safeParse(amount).success).toBe(false)
  })

  it('rejects a number, so a cost can never silently become a float', () => {
    expect(usdAmountSchema.safeParse(0.5).success).toBe(false)
  })
})

describe('usage report schema', () => {
  it('parses the report the backend sends', () => {
    expect(usageReportSchema.safeParse(usageReportWire()).success).toBe(true)
  })

  it('accepts a missing latency and an unfamiliar purpose', () => {
    const report = usageReportWire({
      average_latency_ms: null,
      by_purpose: [
        {
          purpose: 'brand_voice_check',
          requests: 1,
          input_tokens: 1,
          output_tokens: 1,
          estimated_cost: '0',
        },
      ],
    })
    expect(usageReportSchema.safeParse(report).success).toBe(true)
  })

  it.each([
    ['a negative count', { failed_requests: -1 }],
    ['a fractional count', { unpriced_requests: 1.5 }],
    ['a malformed total cost', { totals: { ...usageReportWire().totals, estimated_cost: '1e-7' } }],
    [
      'a malformed daily cost',
      { daily: [{ date: '2026-10-01', requests: 1, estimated_cost: 0.5 }] },
    ],
    ['a bad date', { range: { start: '01/10/2026', end: '2026-10-03' } }],
  ])('rejects %s', (_name, change) => {
    expect(usageReportSchema.safeParse(usageReportWire(change)).success).toBe(false)
  })
})

describe('fetchUsage', () => {
  it.each(DASHBOARD_RANGES)(
    'asks for the %s period as inclusive UTC days ending today',
    async (range) => {
      const fetchImpl = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(JSON.stringify(usageReportWire()), { status: 200 })),
      )
      const client = createApiClient({
        baseUrl: 'https://api.test',
        getToken: () => Promise.resolve('tok'),
        getSelectedOrganizationId: () => 'org',
        fetchImpl,
      })
      await fetchUsage(client, range)
      const input = fetchImpl.mock.calls[0]?.[0]
      if (input === undefined) throw new Error('No request was made')
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      )
      expect(url.pathname).toBe('/api/v1/usage')
      const from = Date.parse(url.searchParams.get('from') ?? '')
      const to = Date.parse(url.searchParams.get('to') ?? '')
      const days = Number(range.replace('d', ''))
      expect((to - from) / 86_400_000 + 1).toBe(days)
    },
  )
})
