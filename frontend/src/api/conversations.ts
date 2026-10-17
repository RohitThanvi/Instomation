import { z } from 'zod'
import type { ApiClient } from './client'
import { paginated } from './schemas'
import { API_PREFIX, MAX_THREAD_PAGES, MESSAGE_PAGE_SIZE, PAGE_SIZE } from '@/config/constants'

/** Enum values exactly as `backend/app/models/enums.py` sends them (lowercase). */
export const CONVERSATION_STATES = [
  'ai_active',
  'human_required',
  'human_active',
  'resolved',
] as const
export const conversationStateSchema = z.enum(CONVERSATION_STATES)
export type ConversationState = z.infer<typeof conversationStateSchema>

export const PRIORITIES = ['low', 'normal', 'high'] as const
export const prioritySchema = z.enum(PRIORITIES)
export type Priority = z.infer<typeof prioritySchema>

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const
export const MESSAGE_ORIGINS = ['customer', 'ai', 'human', 'internal_note'] as const
export const messageOriginSchema = z.enum(MESSAGE_ORIGINS)
export type MessageOrigin = z.infer<typeof messageOriginSchema>

export const MESSAGE_CHANNELS = ['dm', 'comment', 'private_reply'] as const
export const messageChannelSchema = z.enum(MESSAGE_CHANNELS)
export type MessageChannel = z.infer<typeof messageChannelSchema>

export const DELIVERY_STATUSES = ['received', 'pending', 'sent', 'failed', 'suppressed'] as const
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES)
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>

export const INTENTS = [
  'greeting',
  'product_query',
  'price_query',
  'service_query',
  'order_query',
  'shipping_query',
  'booking_query',
  'collaboration',
  'sponsorship',
  'affiliate',
  'complaint',
  'support',
  'general_question',
  'positive_comment',
  'negative_comment',
  'spam',
  'sexual',
  'offensive',
  'harassment',
  'uncertain',
  'human_required',
] as const
export const intentSchema = z.enum(INTENTS)
export type Intent = z.infer<typeof intentSchema>

const timestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO timestamp')

export const customerSchema = z.object({
  id: z.string().uuid(),
  external_user_id: z.string(),
  username: z.string().nullable(),
  display_name: z.string().nullable(),
})
export type Customer = z.infer<typeof customerSchema>

export const conversationSchema = z.object({
  id: z.string().uuid(),
  instagram_account_id: z.string().uuid(),
  customer: customerSchema,
  state: conversationStateSchema,
  priority: prioritySchema,
  last_intent: intentSchema.nullable(),
  is_lead: z.boolean(),
  tags: z.array(z.string()),
  summary: z.string().nullable(),
  unread_count: z.number().int().nonnegative(),
  assigned_user_id: z.string().uuid().nullable(),
  last_message_at: timestampSchema.nullable(),
  created_at: timestampSchema,
})
export type Conversation = z.infer<typeof conversationSchema>

export const messageSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(MESSAGE_DIRECTIONS),
  origin: messageOriginSchema,
  /** Where the message lives on Instagram; `null` for internal notes, which are never sent. */
  channel: messageChannelSchema.nullable(),
  body: z.string(),
  status: deliveryStatusSchema,
  intent: intentSchema.nullable(),
  /** The backend does not document the scale yet; the UI only shows values within 0 to 1. */
  ai_confidence: z.number().nullable(),
  author_user_id: z.string().uuid().nullable(),
  created_at: timestampSchema,
})
export type Message = z.infer<typeof messageSchema>

const conversationPageSchema = paginated(conversationSchema)
const messagePageSchema = paginated(messageSchema)

/** Server-side filters. Search and sort are not supported by the API and happen in the browser. */
export interface ConversationFilters {
  state?: ConversationState | undefined
  priority?: Priority | undefined
  isLead?: boolean | undefined
  tag?: string | undefined
}

export interface ConversationPatch {
  priority?: Priority
  tags?: string[]
  is_lead?: boolean
}

const base = `${API_PREFIX}/conversations`

/**
 * The server pages by creation time, oldest first (`keyset_page`), and cannot sort by latest
 * activity or search text. Page 1 is therefore the oldest conversations, and the inbox says so.
 */
export function fetchConversations(
  client: ApiClient,
  filters: ConversationFilters,
  cursor: string | null,
  signal?: AbortSignal,
) {
  return client.request({
    path: base,
    schema: conversationPageSchema,
    query: {
      limit: PAGE_SIZE,
      cursor,
      state: filters.state,
      priority: filters.priority,
      is_lead: filters.isLead,
      tag: filters.tag,
    },
    signal,
  })
}

/** Note: the server marks the conversation as read when it is fetched. */
export function fetchConversation(client: ApiClient, id: string, signal?: AbortSignal) {
  return client.request({ path: `${base}/${id}`, schema: conversationSchema, signal })
}

export function updateConversation(client: ApiClient, id: string, patch: ConversationPatch) {
  return client.request({
    method: 'PATCH',
    path: `${base}/${id}`,
    schema: conversationSchema,
    body: patch,
  })
}

export function takeOverConversation(client: ApiClient, id: string) {
  return client.request({
    method: 'POST',
    path: `${base}/${id}/takeover`,
    schema: conversationSchema,
  })
}

export function handBackConversation(client: ApiClient, id: string) {
  return client.request({
    method: 'POST',
    path: `${base}/${id}/hand-back`,
    schema: conversationSchema,
  })
}

export function resolveConversation(client: ApiClient, id: string) {
  return client.request({
    method: 'POST',
    path: `${base}/${id}/resolve`,
    schema: conversationSchema,
  })
}

function fetchMessagePage(
  client: ApiClient,
  id: string,
  cursor: string | null,
  signal?: AbortSignal,
) {
  return client.request({
    path: `${base}/${id}/messages`,
    schema: messagePageSchema,
    query: { limit: MESSAGE_PAGE_SIZE, cursor },
    signal,
  })
}

export interface Thread {
  /** Oldest first, as the server returns them. */
  items: Message[]
  /** True when the conversation has more messages than the page cap allows us to load. */
  truncated: boolean
}

/**
 * The API pages oldest-first, so the newest messages live on the last page; the whole thread is
 * therefore loaded (bounded by `MAX_THREAD_PAGES`) rather than just the first page.
 */
export async function fetchThread(
  client: ApiClient,
  id: string,
  signal?: AbortSignal,
): Promise<Thread> {
  const items: Message[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const result = await fetchMessagePage(client, id, cursor, signal)
    items.push(...result.items)
    if (result.next_cursor === null) return { items, truncated: false }
    cursor = result.next_cursor
  }
  return { items, truncated: true }
}

/** Sends a reply to the customer. Only valid while a human controls the conversation (else 409). */
export function sendReply(client: ApiClient, id: string, body: string) {
  return client.request({
    method: 'POST',
    path: `${base}/${id}/messages`,
    schema: messageSchema,
    body: { body },
  })
}

/** Internal notes are visible to the team only and are never sent to the customer. */
export function addNote(client: ApiClient, id: string, body: string) {
  return client.request({
    method: 'POST',
    path: `${base}/${id}/notes`,
    schema: messageSchema,
    body: { body },
  })
}
