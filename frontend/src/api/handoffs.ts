import { z } from 'zod'
import type { ApiClient } from './client'
import {
  conversationStateSchema,
  customerSchema,
  prioritySchema,
  timestampSchema,
} from './conversations'
import { paginated } from './schemas'
import { API_PREFIX, PAGE_SIZE } from '@/config/constants'

/** Exactly as `backend/app/models/enums.py` `HandoffReason` sends them. */
export const HANDOFF_REASONS = [
  'customer_requested',
  'complaint',
  'refund_dispute',
  'legal',
  'threat',
  'high_value_lead',
  'collaboration',
  'low_confidence',
  'missing_information',
  'repeated_dissatisfaction',
  'manual',
] as const
export const handoffReasonSchema = z.enum(HANDOFF_REASONS)
export type HandoffReason = z.infer<typeof handoffReasonSchema>

/** Exactly as `HandoffStatus` sends them. */
export const HANDOFF_STATUSES = ['open', 'assigned', 'resolved'] as const
export const handoffStatusSchema = z.enum(HANDOFF_STATUSES)
export type HandoffStatus = z.infer<typeof handoffStatusSchema>

/** Mirrors `backend/app/schemas/handoffs.py` `HandoffOut`. */
export const handoffSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  customer: customerSchema,
  conversation_state: conversationStateSchema,
  conversation_priority: prioritySchema,
  reason: handoffReasonSchema,
  status: handoffStatusSchema,
  assigned_user_id: z.string().uuid().nullable(),
  created_at: timestampSchema,
  resolved_at: timestampSchema.nullable(),
})
export type Handoff = z.infer<typeof handoffSchema>

const count = z.number().int().nonnegative()

/** Mirrors `HandoffCounts`: handoffs waiting for a person, and ones a person is handling. */
export const handoffCountsSchema = z.object({ open: count, assigned: count })
export type HandoffCounts = z.infer<typeof handoffCountsSchema>

const base = `${API_PREFIX}/handoffs`
const handoffPageSchema = paginated(handoffSchema)

/**
 * One page, longest-waiting first. Without `resolved` the server lists the unresolved queue
 * (open and assigned); with it, only resolved handoffs.
 */
export function fetchHandoffsPage(
  client: ApiClient,
  { resolved, cursor }: { resolved: boolean; cursor: string | null },
  signal?: AbortSignal,
) {
  return client.request({
    path: base,
    schema: handoffPageSchema,
    query: { status: resolved ? 'resolved' : undefined, cursor, limit: PAGE_SIZE },
    signal,
  })
}

export function fetchHandoffCounts(client: ApiClient, signal?: AbortSignal) {
  return client.request({ path: `${base}/counts`, schema: handoffCountsSchema, signal })
}
