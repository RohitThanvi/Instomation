import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import {
  deleteKnowledgeEntry,
  fetchKnowledgePage,
  KNOWLEDGE_KINDS,
  knowledgeEntrySchema,
  listKnowledgeEntries,
  searchKnowledge,
  updateKnowledgeEntry,
} from './knowledge'

const ID = '00000000-0000-4000-8000-000000000001'
const ENTRY = { id: ID, kind: 'faq', title: 'Hours', content: '9 to 5' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function setup(...responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>()
  for (const response of responses) fetchImpl.mockResolvedValueOnce(response)
  const client = createApiClient({
    baseUrl: 'https://api.test',
    getToken: () => Promise.resolve('tok'),
    getSelectedOrganizationId: () => null,
    fetchImpl,
  })
  const lastRequest = () => {
    const [input, init] = fetchImpl.mock.calls.at(-1) ?? []
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
    return {
      url: new URL(href ?? ''),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }
  }
  return { client, fetchImpl, lastRequest }
}

describe('knowledge API', () => {
  it('knows exactly the kinds the backend sends', () => {
    expect([...KNOWLEDGE_KINDS]).toEqual([
      'faq',
      'product',
      'service',
      'policy',
      'website',
      'custom',
    ])
    expect(knowledgeEntrySchema.safeParse({ ...ENTRY, kind: 'recipe' }).success).toBe(false)
  })

  it('asks for a page with the kind only when one is chosen', async () => {
    const { client, lastRequest } = setup(
      json({ items: [], next_cursor: null }),
      json({ items: [], next_cursor: null }),
    )
    await fetchKnowledgePage(client, { kind: null, cursor: null, limit: 20 })
    expect(lastRequest().url.searchParams.has('kind')).toBe(false)
    expect(lastRequest().url.searchParams.has('cursor')).toBe(false)
    expect(lastRequest().url.searchParams.get('limit')).toBe('20')

    await fetchKnowledgePage(client, { kind: 'policy', cursor: 'abc', limit: 20 })
    expect(lastRequest().url.searchParams.get('kind')).toBe('policy')
    expect(lastRequest().url.searchParams.get('cursor')).toBe('abc')
  })

  it('lists every entry across pages', async () => {
    const second = { ...ENTRY, id: '00000000-0000-4000-8000-000000000002', title: 'Returns' }
    const { client, fetchImpl } = setup(
      json({ items: [ENTRY], next_cursor: 'next' }),
      json({ items: [second], next_cursor: null }),
    )
    expect((await listKnowledgeEntries(client)).map((entry) => entry.title)).toEqual([
      'Hours',
      'Returns',
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops, rather than looping, if the cursor never ends', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(json({ items: [], next_cursor: 'again' })))
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => Promise.resolve('tok'),
      getSelectedOrganizationId: () => null,
      fetchImpl,
    })
    await expect(listKnowledgeEntries(client)).rejects.toThrow(/more pages than expected/)
    expect(fetchImpl).toHaveBeenCalledTimes(20)
  })

  it('treats a 204 as a successful delete', async () => {
    const { client, lastRequest } = setup(new Response(null, { status: 204 }))
    await expect(deleteKnowledgeEntry(client, ID)).resolves.toBeUndefined()
    expect(lastRequest().method).toBe('DELETE')
    expect(lastRequest().url.pathname).toBe(`/api/v1/knowledge/entries/${ID}`)
  })

  it('updates only the fields it is given', async () => {
    const { client, lastRequest } = setup(json({ ...ENTRY, title: 'New' }))
    await updateKnowledgeEntry(client, ID, { title: 'New' })
    expect(lastRequest().method).toBe('PATCH')
    expect(lastRequest().body).toEqual({ title: 'New' })
  })

  it('searches with the text and returns hits in the order given', async () => {
    const other = { ...ENTRY, id: '00000000-0000-4000-8000-000000000002', title: 'Returns' }
    const { client, lastRequest } = setup(
      json([
        { entry: other, score: 0.9 },
        { entry: ENTRY, score: 0.4 },
      ]),
    )
    const hits = await searchKnowledge(client, 'refund')
    expect(hits.map((hit) => hit.entry.title)).toEqual(['Returns', 'Hours'])
    expect(lastRequest().body).toEqual({ query: 'refund' })
    expect(lastRequest().url.pathname).toBe('/api/v1/knowledge/search')
  })
})
