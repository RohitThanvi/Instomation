import { z } from 'zod'
import type { ApiClient } from './client'
import { timestampSchema } from './conversations'
import { handoffReasonSchema } from './handoffs'
import { paginated } from './schemas'
import { API_PREFIX } from '@/config/constants'

/** Which messages a rule looks at, exactly as the backend's `RuleScope` sends them. */
export const RULE_SCOPES = ['dm', 'comment', 'both'] as const
export const ruleScopeSchema = z.enum(RULE_SCOPES)
export type RuleScope = z.infer<typeof ruleScopeSchema>

export const KEYWORD_MATCHES = ['any', 'all'] as const
export const keywordMatchSchema = z.enum(KEYWORD_MATCHES)
export type KeywordMatch = z.infer<typeof keywordMatchSchema>

export const RULE_ACTIONS = ['reply', 'handoff', 'skip'] as const
export const ruleActionSchema = z.enum(RULE_ACTIONS)
export type RuleAction = z.infer<typeof ruleActionSchema>

/** Mirrors `backend/app/schemas/automation.py`. The reply-text limits depend on the channel. */
export const RULE_LIMITS = {
  name: 200,
  keywords: 20,
  keyword: 60,
} as const

/** `RuleOut`: one automation rule, in the order the server tries them. */
export const ruleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  priority: z.number().int().nonnegative(),
  applies_to: ruleScopeSchema,
  keywords: z.array(z.string()),
  keyword_match: keywordMatchSchema,
  action: ruleActionSchema,
  reply_text: z.string().nullable(),
  private_reply_text: z.string().nullable(),
  handoff_reason: handoffReasonSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
})
export type Rule = z.infer<typeof ruleSchema>

/** `RuleIn`: what creates or replaces a rule. A rule is always sent whole. */
export type RuleInput = Omit<Rule, 'id' | 'priority' | 'created_at' | 'updated_at'>

export const previewResultSchema = z.object({ rule: ruleSchema.nullable() })
export type PreviewResult = z.infer<typeof previewResultSchema>

const base = `${API_PREFIX}/automations`
const rulePageSchema = paginated(ruleSchema)

/** Every rule, in the order they are tried. An organization has few, so this is one page. */
export async function fetchRules(client: ApiClient, signal?: AbortSignal): Promise<Rule[]> {
  const page = await client.request({ path: base, schema: rulePageSchema, signal })
  return page.items
}

export function createRule(client: ApiClient, rule: RuleInput) {
  return client.request({ method: 'POST', path: base, schema: ruleSchema, body: rule })
}

export function replaceRule(client: ApiClient, id: string, rule: RuleInput) {
  return client.request({ method: 'PUT', path: `${base}/${id}`, schema: ruleSchema, body: rule })
}

export function deleteRule(client: ApiClient, id: string) {
  return client.request({ method: 'DELETE', path: `${base}/${id}`, schema: z.undefined() })
}

/** The whole list of ids, in the order they should be tried; the server refuses a stale list. */
export async function reorderRules(client: ApiClient, ids: readonly string[]): Promise<Rule[]> {
  const page = await client.request({
    method: 'PUT',
    path: `${base}/order`,
    schema: rulePageSchema,
    body: { ids },
  })
  return page.items
}

/** Which rule would answer a made-up message. Only rules are checked, not the other safety gates. */
export function previewRule(client: ApiClient, scope: 'dm' | 'comment', text: string) {
  return client.request({
    method: 'POST',
    path: `${base}/preview`,
    schema: previewResultSchema,
    body: { scope, text },
  })
}
