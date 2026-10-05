import { z } from 'zod'
import {
  conversationStateSchema,
  prioritySchema,
  type Conversation,
  type ConversationFilters,
  type ConversationState,
  type Priority,
} from '@/api/conversations'
import { MAX_TAG_LENGTH } from '@/config/constants'
import { customerName } from './labels'

export const SORTS = ['recent', 'unread'] as const
export type InboxSort = (typeof SORTS)[number]
export const DEFAULT_SORT: InboxSort = 'recent'

export const SORT_LABELS: Record<InboxSort, string> = {
  recent: 'Latest activity',
  unread: 'Unread first',
}

export interface InboxFilters {
  state?: ConversationState | undefined
  priority?: Priority | undefined
  leadsOnly: boolean
  tag?: string | undefined
  /** Matched in the browser against the conversations loaded so far. */
  query: string
  sort: InboxSort
}

export const EMPTY_FILTERS: InboxFilters = { leadsOnly: false, query: '', sort: DEFAULT_SORT }

const tagSchema = z.string().trim().min(1).max(MAX_TAG_LENGTH)
const sortSchema = z.enum(SORTS)

/** Anything in the URL that is not valid is ignored rather than trusted. */
export function parseFilters(params: URLSearchParams): InboxFilters {
  return {
    state: conversationStateSchema.safeParse(params.get('state')).data,
    priority: prioritySchema.safeParse(params.get('priority')).data,
    leadsOnly: params.get('leads') === '1',
    tag: tagSchema.safeParse(params.get('tag')).data,
    query: params.get('q')?.trim() ?? '',
    sort: sortSchema.safeParse(params.get('sort')).data ?? DEFAULT_SORT,
  }
}

export function toSearchParams(filters: InboxFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.state !== undefined) params.set('state', filters.state)
  if (filters.priority !== undefined) params.set('priority', filters.priority)
  if (filters.leadsOnly) params.set('leads', '1')
  if (filters.tag !== undefined) params.set('tag', filters.tag)
  if (filters.query !== '') params.set('q', filters.query)
  if (filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort)
  return params
}

/** The subset the API can filter on. Changing it changes what is fetched. */
export function toServerFilters(filters: InboxFilters): ConversationFilters {
  return {
    state: filters.state,
    priority: filters.priority,
    isLead: filters.leadsOnly ? true : undefined,
    tag: filters.tag,
  }
}

export function hasActiveFilters(filters: InboxFilters): boolean {
  return (
    filters.state !== undefined ||
    filters.priority !== undefined ||
    filters.leadsOnly ||
    filters.tag !== undefined ||
    filters.query !== ''
  )
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/^@/, '')
}

export function searchConversations(items: readonly Conversation[], query: string): Conversation[] {
  const needle = normalize(query.trim())
  if (needle === '') return [...items]
  return items.filter((conversation) => {
    const haystack = [
      customerName(conversation.customer),
      conversation.customer.username ?? '',
      conversation.summary ?? '',
      ...conversation.tags,
    ]
    return haystack.some((text) => normalize(text).includes(needle))
  })
}

function activityTime(conversation: Conversation): number {
  return Date.parse(conversation.last_message_at ?? conversation.created_at)
}

export function sortConversations(items: readonly Conversation[], sort: InboxSort): Conversation[] {
  return [...items].sort((a, b) => {
    if (sort === 'unread' && a.unread_count !== b.unread_count) {
      return b.unread_count - a.unread_count
    }
    return activityTime(b) - activityTime(a)
  })
}
