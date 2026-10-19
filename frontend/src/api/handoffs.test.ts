import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import {
  fetchHandoffCounts,
  fetchHandoffsPage,
  HANDOFF_REASONS,
  HANDOFF_STATUSES,
  handoffCountsSchema,
  handoffSchema,
} from './handoffs'
import { PAGE_SIZE } from '@/config/constants'
import { handoffWire } from '@/test/fixtures'

function clientReturning(body: unknown) {
  const fetchImpl = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  )
  const client = createApiClient({
    baseUrl: 'https://api.test',
    getToken: () => Promise.resolve('tok'),
    getSelectedOrganizationId: () => 'org',
    fetchImpl,
  })
  return { client, fetchImpl }
}

function requestedUrl(fetchImpl: ReturnType<typeof clientReturning>['fetchImpl']): URL {
  const input = fetchImpl.mock.calls[0]?.[0]
  if (input === undefined) throw new Error('No request was made')
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
}

describe('handoff schemas', () => {
  it('parse every reason and status the backend can send', () => {
    for (const reason of HANDOFF_REASONS) {
      expect(handoffSchema.safeParse(handoffWire({ reason })).success).toBe(true)
    }
    for (const status of HANDOFF_STATUSES) {
      const resolved_at = status === 'resolved' ? '2026-10-05T09:30:00Z' : null
      expect(handoffSchema.safeParse(handoffWire({ status, resolved_at })).success).toBe(true)
    }
  })

  it('reject a reason or status the app does not know, instead of showing it blank', () => {
    expect(handoffSchema.safeParse(handoffWire({ reason: 'vip' })).success).toBe(false)
    expect(handoffSchema.safeParse(handoffWire({ status: 'snoozed' })).success).toBe(false)
  })

  it('reject counts that are negative or fractional', () => {
    expect(handoffCountsSchema.safeParse({ open: 3, assigned: 0 }).success).toBe(true)
    expect(handoffCountsSchema.safeParse({ open: -1, assigned: 0 }).success).toBe(false)
    expect(handoffCountsSchema.safeParse({ open: 1.5, assigned: 0 }).success).toBe(false)
  })
})

describe('handoff requests', () => {
  it('asks for the unresolved queue by sending no status', async () => {
    const { client, fetchImpl } = clientReturning({ items: [handoffWire()], next_cursor: null })
    const page = await fetchHandoffsPage(client, { resolved: false, cursor: null })
    const url = requestedUrl(fetchImpl)
    expect(url.pathname).toBe('/api/v1/handoffs')
    expect(url.searchParams.has('status')).toBe(false)
    expect(url.searchParams.get('limit')).toBe(String(PAGE_SIZE))
    expect(page.items).toHaveLength(1)
  })

  it('asks for resolved handoffs and passes the cursor on', async () => {
    const { client, fetchImpl } = clientReturning({ items: [], next_cursor: null })
    await fetchHandoffsPage(client, { resolved: true, cursor: 'abc' })
    const url = requestedUrl(fetchImpl)
    expect(url.searchParams.get('status')).toBe('resolved')
    expect(url.searchParams.get('cursor')).toBe('abc')
  })

  it('reads the counts', async () => {
    const { client, fetchImpl } = clientReturning({ open: 4, assigned: 2 })
    await expect(fetchHandoffCounts(client)).resolves.toEqual({ open: 4, assigned: 2 })
    expect(requestedUrl(fetchImpl).pathname).toBe('/api/v1/handoffs/counts')
  })
})
