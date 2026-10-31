import type { KeywordMatch, Rule, RuleAction, RuleScope } from '@/api/automations'
import type { HandoffReason } from '@/api/handoffs'

export const SCOPE_LABELS: Record<RuleScope, string> = {
  dm: 'Direct messages',
  comment: 'Comments',
  both: 'Comments and direct messages',
}

export const ACTION_LABELS: Record<RuleAction, string> = {
  reply: 'Send a reply',
  handoff: 'Hand over to a person',
  skip: 'Send nothing',
}

export const MATCH_LABELS: Record<KeywordMatch, string> = {
  any: 'any of these',
  all: 'all of these',
}

/** The reasons that make sense for a rule to give; the server accepts others. */
export const RULE_HANDOFF_REASONS: readonly HandoffReason[] = [
  'customer_requested',
  'complaint',
  'refund_dispute',
  'legal',
  'high_value_lead',
  'collaboration',
  'manual',
]

/** One line that says what the rule does, for the list. */
export function describeAction(
  rule: Pick<Rule, 'action' | 'reply_text' | 'private_reply_text'>,
): string {
  if (rule.action === 'skip') return 'Sends nothing, so nobody is replied to automatically'
  if (rule.action === 'handoff') return 'Hands the conversation to a person'
  return rule.private_reply_text === null
    ? 'Sends a fixed reply'
    : 'Sends a fixed reply and a private message'
}
