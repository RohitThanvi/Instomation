import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  productEntry,
  profileBody,
  saveBusinessSetup,
  type BusinessProfile,
  type BusinessSetup,
} from './business'
import type { ApiClient, RequestOptions } from './client'
import { ApiError } from './errors'

const SETUP: BusinessSetup = {
  profile: {
    brand_name: 'Acme',
    category: 'Skincare',
    description: 'Gentle skincare.',
    website: 'https://acme.test',
  },
  products: {
    items: [
      { kind: 'product', name: 'Day cream', description: 'SPF 30', price: '$20', url: '' },
      { kind: 'service', name: 'Consultation', description: '', price: '', url: '' },
    ],
  },
  style: { tone: 'friendly', notes: 'Use first names.' },
  automation: { reply_to_comments: true, reply_to_dms: false },
}

const STORED_PROFILE: BusinessProfile = {
  brand_name: 'Old name',
  description: null,
  industry: null,
  location: 'Jaipur',
  website: null,
  contact_info: { Phone: '123' },
  policies: { Returns: '30 days' },
  communication_style: 'professional',
  custom_instructions: null,
}

interface Entry {
  id: string
  kind: string
  title: string
  content: string
}

interface Call {
  method: string
  path: string
  body?: unknown
}

/** A tiny in-memory stand-in for the three endpoints, validating each response like the real client. */
function fakeServer(options: { entries?: Entry[]; failOn?: (call: Call) => boolean } = {}) {
  const calls: Call[] = []
  const state = {
    profile: STORED_PROFILE,
    entries: options.entries ?? [],
    ai: {
      dm_automation_enabled: false,
      comment_automation_enabled: false,
      confidence_threshold: 0.7,
      max_response_tokens: 300,
      temperature: 0.3,
      max_replies_per_conversation_per_hour: 5,
    },
  }
  const PAGE = 2
  let nextId = 1

  const client: ApiClient = {
    request: <S extends z.ZodType>(request: RequestOptions<S>): Promise<z.infer<S>> => {
      const call: Call = { method: request.method ?? 'GET', path: request.path, body: request.body }
      calls.push(call)
      if (options.failOn?.(call) === true) {
        return Promise.reject(new ApiError(500, 'INTERNAL_ERROR', 'Something broke.'))
      }
      const body = request.body as Record<string, unknown> | undefined
      let result: unknown
      if (request.path === '/api/v1/business/profile') {
        if (call.method === 'PUT') state.profile = request.body as BusinessProfile
        result = state.profile
      } else if (request.path === '/api/v1/settings/ai') {
        state.ai = { ...state.ai, ...body }
        result = state.ai
      } else if (request.path === '/api/v1/knowledge/entries' && call.method === 'GET') {
        const start = Number(request.query?.cursor ?? 0)
        const items = state.entries.slice(start, start + PAGE)
        const more = start + PAGE < state.entries.length
        result = { items, next_cursor: more ? String(start + PAGE) : null }
      } else if (request.path === '/api/v1/knowledge/entries') {
        const entry = { id: crypto.randomUUID(), ...(body as Omit<Entry, 'id'>) }
        nextId += 1
        state.entries.push(entry)
        result = entry
      } else {
        const id = request.path.split('/').pop()
        const entry = state.entries.find((candidate) => candidate.id === id)
        if (entry === undefined) throw new Error(`unexpected ${call.method} ${request.path}`)
        Object.assign(entry, body)
        result = entry
      }
      return Promise.resolve(request.schema.parse(result))
    },
  }
  return { client, calls, state, createdCount: () => nextId - 1 }
}

const writes = (calls: Call[]) =>
  calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.path}`)

describe('profileBody', () => {
  it('lays the answers over the stored profile and keeps what onboarding never asks for', () => {
    expect(profileBody(STORED_PROFILE, SETUP)).toEqual({
      brand_name: 'Acme',
      industry: 'Skincare',
      description: 'Gentle skincare.',
      website: 'https://acme.test',
      communication_style: 'friendly',
      custom_instructions: 'Use first names.',
      location: 'Jaipur',
      contact_info: { Phone: '123' },
      policies: { Returns: '30 days' },
    })
  })

  it('sends null, not an empty string, for a blank website or notes', () => {
    const blank = {
      ...SETUP,
      profile: { ...SETUP.profile, website: '' },
      style: { tone: 'professional' as const, notes: '' },
    }
    expect(profileBody(STORED_PROFILE, blank)).toMatchObject({
      website: null,
      custom_instructions: null,
    })
  })
})

describe('productEntry', () => {
  it('puts the description, price and link in the text the assistant reads', () => {
    expect(
      productEntry({
        kind: 'product',
        name: 'Day cream',
        description: 'SPF 30',
        price: '$20',
        url: 'https://acme.test/day',
      }),
    ).toEqual({
      kind: 'product',
      title: 'Day cream',
      content: 'SPF 30\nPrice: $20\nLink: https://acme.test/day',
    })
  })

  it('never produces empty content, which the server rejects', () => {
    expect(
      productEntry({ kind: 'service', name: 'Consultation', description: '', price: '', url: '' }),
    ).toEqual({ kind: 'service', title: 'Consultation', content: 'Consultation' })
  })
})

describe('saveBusinessSetup', () => {
  it('saves the profile, then the products, and switches replies on last', async () => {
    const { client, calls, state } = fakeServer()
    const settings = await saveBusinessSetup(client, SETUP)

    expect(writes(calls)).toEqual([
      'PUT /api/v1/business/profile',
      'POST /api/v1/knowledge/entries',
      'POST /api/v1/knowledge/entries',
      'PATCH /api/v1/settings/ai',
    ])
    expect(calls.at(-1)?.body).toEqual({
      dm_automation_enabled: false,
      comment_automation_enabled: true,
    })
    expect(settings).toMatchObject({
      dm_automation_enabled: false,
      comment_automation_enabled: true,
    })
    expect(state.profile.location).toBe('Jaipur')
  })

  it('does not touch the knowledge base when there are no products', async () => {
    const { client, calls } = fakeServer()
    await saveBusinessSetup(client, { ...SETUP, products: { items: [] } })
    expect(calls.some((call) => call.path.includes('knowledge'))).toBe(false)
  })

  it('is safe to run twice: the second save writes no knowledge entries and creates no duplicates', async () => {
    const server = fakeServer()
    await saveBusinessSetup(server.client, SETUP)
    server.calls.length = 0
    await saveBusinessSetup(server.client, SETUP)

    expect(writes(server.calls).filter((call) => call.includes('knowledge'))).toEqual([])
    expect(server.state.entries).toHaveLength(2)
  })

  it('updates an entry with the same kind and name, and leaves every other entry alone', async () => {
    const existing: Entry[] = [
      { id: crypto.randomUUID(), kind: 'faq', title: 'Hours', content: '9 to 5' },
      { id: crypto.randomUUID(), kind: 'product', title: 'Day cream', content: 'old text' },
      { id: crypto.randomUUID(), kind: 'service', title: 'Day cream', content: 'a service' },
    ]
    const server = fakeServer({ entries: existing })
    await saveBusinessSetup(server.client, SETUP)

    expect(server.calls.filter((call) => call.method === 'DELETE')).toEqual([])
    expect(server.state.entries.find((entry) => entry.kind === 'product')?.content).toBe(
      'SPF 30\nPrice: $20',
    )
    expect(server.state.entries.find((entry) => entry.kind === 'service')?.content).toBe(
      'a service',
    )
    expect(server.state.entries.find((entry) => entry.kind === 'faq')?.content).toBe('9 to 5')
    expect(server.state.entries).toHaveLength(4) // the three it had, plus the new Consultation
  })

  it('finds a matching entry on a later page of the list', async () => {
    const filler = Array.from({ length: 5 }, (_, index) => ({
      id: crypto.randomUUID(),
      kind: 'faq',
      title: `Question ${index}`,
      content: 'answer',
    }))
    const target = {
      id: crypto.randomUUID(),
      kind: 'product',
      title: 'Day cream',
      content: 'SPF 30\nPrice: $20',
    }
    const server = fakeServer({ entries: [...filler, target] })
    await saveBusinessSetup(server.client, {
      ...SETUP,
      products: { items: SETUP.products.items.slice(0, 1) },
    })
    expect(writes(server.calls).filter((call) => call.includes('knowledge'))).toEqual([])
  })

  it('creates one entry, not two, for two items with the same kind and name', async () => {
    const server = fakeServer()
    const item = SETUP.products.items[0]
    if (item === undefined) throw new Error('fixture')
    await saveBusinessSetup(server.client, {
      ...SETUP,
      products: { items: [item, { ...item, price: '$25' }] },
    })
    expect(server.state.entries).toHaveLength(1)
    expect(server.state.entries[0]?.content).toContain('$25')
  })

  it('never switches replies on when the products fail to save, and a retry finishes the job', async () => {
    let failing = true
    const server = fakeServer({
      failOn: (call) => failing && call.method === 'POST' && call.path.includes('knowledge'),
    })
    await expect(saveBusinessSetup(server.client, SETUP)).rejects.toBeInstanceOf(ApiError)
    expect(server.calls.some((call) => call.path === '/api/v1/settings/ai')).toBe(false)
    expect(server.state.ai.comment_automation_enabled).toBe(false)

    failing = false
    await saveBusinessSetup(server.client, SETUP)
    expect(server.state.ai.comment_automation_enabled).toBe(true)
    expect(server.state.entries).toHaveLength(2)
  })

  it('never switches replies on when the profile fails to save', async () => {
    const server = fakeServer({ failOn: (call) => call.method === 'PUT' })
    await expect(saveBusinessSetup(server.client, SETUP)).rejects.toBeInstanceOf(ApiError)
    expect(writes(server.calls)).toEqual(['PUT /api/v1/business/profile'])
  })
})
