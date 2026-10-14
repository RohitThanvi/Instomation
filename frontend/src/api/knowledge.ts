import { z } from 'zod'
import type { ApiClient } from './client'
import { paginated } from './schemas'
import { API_PREFIX } from '@/config/constants'

/** Exactly as `backend/app/models/enums.py` `KnowledgeKind` sends them. */
export const KNOWLEDGE_KINDS = ['faq', 'product', 'service', 'policy', 'website', 'custom'] as const
export const knowledgeKindSchema = z.enum(KNOWLEDGE_KINDS)
export type KnowledgeKind = z.infer<typeof knowledgeKindSchema>

export const knowledgeEntrySchema = z.object({
  id: z.string().uuid(),
  kind: knowledgeKindSchema,
  title: z.string(),
  content: z.string(),
})
export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>

export interface NewKnowledgeEntry {
  kind: KnowledgeKind
  title: string
  content: string
}

const base = `${API_PREFIX}/knowledge/entries`
/** The server caps `limit` at 100 and an organization holds at most 500 entries. */
const PAGE_LIMIT = 100
const MAX_PAGES = 20
const entryPageSchema = paginated(knowledgeEntrySchema)

/** Every active entry, following the cursor. Bounded so a misbehaving cursor cannot loop forever. */
export async function listKnowledgeEntries(client: ApiClient): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await client.request({
      path: base,
      schema: entryPageSchema,
      query: { limit: PAGE_LIMIT, cursor },
    })
    entries.push(...result.items)
    if (result.next_cursor === null) return entries
    cursor = result.next_cursor
  }
  throw new Error('The knowledge base has more pages than expected.')
}

export function createKnowledgeEntry(client: ApiClient, entry: NewKnowledgeEntry) {
  return client.request({ method: 'POST', path: base, schema: knowledgeEntrySchema, body: entry })
}

export function updateKnowledgeEntry(
  client: ApiClient,
  id: string,
  patch: Partial<NewKnowledgeEntry>,
) {
  return client.request({
    method: 'PATCH',
    path: `${base}/${id}`,
    schema: knowledgeEntrySchema,
    body: patch,
  })
}
