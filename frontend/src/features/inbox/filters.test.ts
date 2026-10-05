import { describe, expect, it } from 'vitest'
import { conversationSchema } from '@/api/conversations'
import { conversationWire, uuid } from '@/test/fixtures'
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  hasActiveFilters,
  parseFilters,
  searchConversations,
  sortConversations,
  toSearchParams,
  toServerFilters,
  type InboxFilters,
} from './filters'

const parse = (query: string) => parseFilters(new URLSearchParams(query))
const conv = (n: number, overrides: Record<string, unknown> = {}) =>
  conversationSchema.parse(conversationWire({ id: uuid(n), ...overrides }))

describe('URL filters', () => {
  it('round-trips every filter', () => {
    const filters: InboxFilters = {
      state: 'human_required',
      priority: 'high',
      leadsOnly: true,
      tag: 'vip',
      query: 'maya',
      sort: 'unread',
    }
    expect(parseFilters(toSearchParams(filters))).toEqual(filters)
  })

  it('writes nothing for the default view', () => {
    expect(toSearchParams(EMPTY_FILTERS).toString()).toBe('')
    expect(parse('')).toEqual(EMPTY_FILTERS)
  })

  it('ignores invalid values instead of trusting them', () => {
    expect(parse('state=HUMAN_ACTIVE&priority=urgent&sort=random&leads=yes&tag=')).toEqual(
      EMPTY_FILTERS,
    )
    expect(parse('tag=' + 'x'.repeat(51)).tag).toBeUndefined()
  })

  it('sends only server-supported filters to the API', () => {
    expect(
      toServerFilters({
        ...EMPTY_FILTERS,
        state: 'resolved',
        leadsOnly: true,
        query: 'ignored',
        sort: 'unread',
      }),
    ).toEqual({ state: 'resolved', priority: undefined, isLead: true, tag: undefined })
    expect(toServerFilters(EMPTY_FILTERS)).toEqual({
      state: undefined,
      priority: undefined,
      isLead: undefined,
      tag: undefined,
    })
  })

  it('knows when anything narrows the list, but not when only the sort changed', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: 'unread' })).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: 'x' })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, leadsOnly: true })).toBe(true)
  })
})

describe('searchConversations', () => {
  const items = [
    conv(1),
    conv(2, {
      customer: { ...conversationWire().customer, username: 'ravi_s', display_name: 'Ravi Shah' },
      tags: ['wholesale'],
      summary: 'Asked about bulk pricing',
    }),
  ]

  it('returns everything for an empty query', () => {
    expect(searchConversations(items, '  ')).toHaveLength(2)
  })

  it.each([
    ['name', 'ravi'],
    ['handle with @', '@ravi_s'],
    ['tag', 'WHOLESALE'],
    ['summary', 'bulk'],
  ])('matches on %s, ignoring case', (_what, query) => {
    expect(searchConversations(items, query).map((c) => c.id)).toEqual([uuid(2)])
  })

  it('returns nothing when nothing matches', () => {
    expect(searchConversations(items, 'zzz')).toEqual([])
  })
})

describe('sortConversations', () => {
  const older = conv(1, { last_message_at: '2026-10-01T10:00:00Z', unread_count: 5 })
  const newer = conv(2, { last_message_at: '2026-10-04T10:00:00Z', unread_count: 0 })
  const never = conv(3, {
    last_message_at: null,
    created_at: '2026-10-02T10:00:00Z',
    unread_count: 1,
  })

  it('puts the most recent activity first by default, falling back to creation time', () => {
    expect(DEFAULT_SORT).toBe('recent')
    expect(sortConversations([older, never, newer], 'recent').map((c) => c.id)).toEqual([
      newer.id,
      never.id,
      older.id,
    ])
  })

  it('puts unread conversations first, then by recency', () => {
    expect(sortConversations([newer, never, older], 'unread').map((c) => c.id)).toEqual([
      older.id,
      never.id,
      newer.id,
    ])
  })

  it('does not mutate its input', () => {
    const input = [older, newer]
    sortConversations(input, 'recent')
    expect(input.map((c) => c.id)).toEqual([older.id, newer.id])
  })
})
