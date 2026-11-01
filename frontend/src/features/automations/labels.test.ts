import { describe, expect, it } from 'vitest'
import { KEYWORD_MATCHES, RULE_ACTIONS, RULE_SCOPES } from '@/api/automations'
import { HANDOFF_REASONS } from '@/api/handoffs'
import { REASON_LABELS } from '@/features/handoffs/labels'
import {
  ACTION_LABELS,
  describeAction,
  MATCH_LABELS,
  RULE_HANDOFF_REASONS,
  SCOPE_LABELS,
} from './labels'

describe('automation labels', () => {
  it('name every scope, action and match mode, distinctly', () => {
    for (const [labels, values] of [
      [SCOPE_LABELS, RULE_SCOPES],
      [ACTION_LABELS, RULE_ACTIONS],
      [MATCH_LABELS, KEYWORD_MATCHES],
    ] as const) {
      const names = values.map((value) => (labels as Record<string, string>)[value])
      expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true)
      expect(new Set(names).size).toBe(values.length)
    }
  })

  it('offers only reasons the backend knows, each with a label', () => {
    for (const reason of RULE_HANDOFF_REASONS) {
      expect(HANDOFF_REASONS).toContain(reason)
      expect(REASON_LABELS[reason]).toBeDefined()
    }
    expect(new Set(RULE_HANDOFF_REASONS).size).toBe(RULE_HANDOFF_REASONS.length)
  })
})

describe('describeAction', () => {
  it('says what each kind of rule does', () => {
    expect(describeAction({ action: 'skip', reply_text: null, private_reply_text: null })).toMatch(
      /sends nothing/i,
    )
    expect(
      describeAction({ action: 'handoff', reply_text: null, private_reply_text: null }),
    ).toMatch(/hands the conversation to a person/i)
    expect(describeAction({ action: 'reply', reply_text: 'x', private_reply_text: null })).toBe(
      'Sends a fixed reply',
    )
    expect(describeAction({ action: 'reply', reply_text: 'x', private_reply_text: 'y' })).toBe(
      'Sends a fixed reply and a private message',
    )
  })
})
