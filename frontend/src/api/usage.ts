import { z } from 'zod'
import { rangeQuery, type DashboardRange } from './analytics'
import type { ApiClient } from './client'
import { API_PREFIX } from '@/config/constants'

const count = z.number().int().nonnegative()
const isoDate = z.string().date()

/**
 * A US-dollar amount as the backend serializes a `Decimal` column: plain fixed-point text such as
 * "0.000432", never an exponent. It is kept as a string end to end and only formatted for display,
 * so a malformed amount fails here instead of showing a wrong total.
 */
export const usdAmountSchema = z.string().regex(/^\d+(\.\d+)?$/)

const usageLineSchema = z.object({
  requests: count,
  input_tokens: count,
  output_tokens: count,
  estimated_cost: usdAmountSchema,
})
export type UsageLine = z.infer<typeof usageLineSchema>

/**
 * `GET /api/v1/usage`, exactly as `UsageReport` in `backend/app/schemas/analytics.py`. `purpose`
 * is free text on the wire (not an enum), so an unfamiliar one is shown as it is, not rejected.
 */
export const usageReportSchema = z.object({
  range: z.object({ start: isoDate, end: isoDate }),
  totals: usageLineSchema,
  failed_requests: count,
  /** Requests that used tokens but have no price on file, so the cost understates real spend. */
  unpriced_requests: count,
  average_latency_ms: count.nullable(),
  by_purpose: z.array(usageLineSchema.extend({ purpose: z.string() })),
  by_model: z.array(usageLineSchema.extend({ provider: z.string(), model: z.string() })),
  daily: z.array(z.object({ date: isoDate, requests: count, estimated_cost: usdAmountSchema })),
})
export type UsageReport = z.infer<typeof usageReportSchema>
export type UsageByPurpose = UsageReport['by_purpose'][number]
export type UsageByModel = UsageReport['by_model'][number]
export type DailyUsage = UsageReport['daily'][number]

export function fetchUsage(client: ApiClient, range: DashboardRange, signal?: AbortSignal) {
  return client.request({
    path: `${API_PREFIX}/usage`,
    schema: usageReportSchema,
    query: rangeQuery(range),
    signal,
  })
}
