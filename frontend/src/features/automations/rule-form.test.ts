import { describe, expect, it } from 'vitest'
import { RULE_LIMITS, type Rule } from '@/api/automations'
import { COMMENT_REPLY_MAX_CHARS, DM_REPLY_MAX_BYTES } from '@/config/constants'
import {
  emptyRuleForm,
  parseKeywords,
  ruleToForm,
  ruleToInput,
  sameRuleInput,
  validateRuleForm,
  type RuleErrors,
  type RuleForm,
} from './rule-form'

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Delivery',
    enabled: true,
    priority: 0,
    applies_to: 'dm',
    keywords: ['delivery', 'shipping'],
    keyword_match: 'any',
    action: 'reply',
    reply_text: 'We deliver across Jaipur.',
    private_reply_text: null,
    handoff_reason: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  }
}

function form(overrides: Partial<RuleForm> = {}): RuleForm {
  return { ...ruleToForm(rule()), ...overrides }
}

function errorsOf(values: RuleForm): RuleErrors {
  const result = validateRuleForm(values)
  if (result.ok) throw new Error('expected validation to fail')
  return result.errors
}

describe('parseKeywords', () => {
  it('reads one keyword or phrase per line, tidying spaces and dropping blanks', () => {
    expect(parseKeywords('  price  \n\n opening   hours \n\t\n delivery')).toEqual([
      'price',
      'opening hours',
      'delivery',
    ])
  })

  it('keeps a repeat once, ignoring case and width, and keeps the first spelling', () => {
    expect(parseKeywords('Price\nprice\nＰＲＩＣＥ\n PRICE \ncost')).toEqual(['Price', 'cost'])
  })

  it('keeps commas inside a phrase', () => {
    expect(parseKeywords('how much, please')).toEqual(['how much, please'])
  })

  it('is empty for nothing', () => {
    expect(parseKeywords('')).toEqual([])
    expect(parseKeywords('  \n \n')).toEqual([])
  })
})

describe('the round trip', () => {
  it('turns a rule into a form and back without changing it', () => {
    const original = rule({
      applies_to: 'both',
      action: 'reply',
      private_reply_text: 'Details by message.',
    })
    const result = validateRuleForm(ruleToForm(original))
    expect(result).toEqual({ ok: true, rule: ruleToInput(original) })
  })

  it.each([
    rule({ action: 'handoff', reply_text: null, handoff_reason: 'refund_dispute' }),
    rule({ action: 'skip', reply_text: null }),
    rule({ enabled: false, keyword_match: 'all' }),
  ])('keeps a $action rule exactly', (original) => {
    expect(validateRuleForm(ruleToForm(original))).toEqual({
      ok: true,
      rule: ruleToInput(original),
    })
  })
})

describe('validateRuleForm', () => {
  it('starts a new rule empty, so it cannot be saved by accident', () => {
    const errors = errorsOf(emptyRuleForm())
    expect(Object.keys(errors).sort()).toEqual(['keywords', 'name', 'reply_text'])
  })

  it('needs a name, tidied, within its limit', () => {
    expect(errorsOf(form({ name: '   ' })).name).toBeDefined()
    expect(errorsOf(form({ name: 'n'.repeat(RULE_LIMITS.name + 1) })).name).toBeDefined()
    const ok = validateRuleForm(form({ name: '  Opening   hours ' }))
    expect(ok).toMatchObject({ ok: true, rule: { name: 'Opening hours' } })
    expect(validateRuleForm(form({ name: 'n'.repeat(RULE_LIMITS.name) })).ok).toBe(true)
  })

  it('needs at least one keyword and at most twenty, each within sixty characters', () => {
    expect(errorsOf(form({ keywords: ' \n ' })).keywords).toMatch(/at least one/)
    const twenty = Array.from({ length: RULE_LIMITS.keywords }, (_, i) => `kw${String(i)}`)
    expect(validateRuleForm(form({ keywords: twenty.join('\n') })).ok).toBe(true)
    const twentyOne = [...twenty, 'one more'].join('\n')
    expect(errorsOf(form({ keywords: twentyOne })).keywords).toMatch(/at most 20/)
    const ok = 'k'.repeat(RULE_LIMITS.keyword)
    expect(validateRuleForm(form({ keywords: ok })).ok).toBe(true)
    expect(errorsOf(form({ keywords: `${ok}x` })).keywords).toMatch(/longer than 60/)
  })

  it('counts a repeated keyword once toward the limit', () => {
    const lines = Array.from({ length: 30 }, () => 'same').join('\n')
    expect(validateRuleForm(form({ keywords: lines })).ok).toBe(true)
  })

  it('counts characters like the server does, so an emoji counts as one', () => {
    expect(validateRuleForm(form({ keywords: '😀'.repeat(RULE_LIMITS.keyword) })).ok).toBe(true)
    expect(
      errorsOf(form({ keywords: '😀'.repeat(RULE_LIMITS.keyword + 1) })).keywords,
    ).toBeDefined()
  })

  describe('a reply rule', () => {
    it('needs text, which is trimmed', () => {
      expect(errorsOf(form({ reply_text: '   ' })).reply_text).toMatch(/Write the reply/)
      expect(validateRuleForm(form({ reply_text: '  Hi  ' }))).toMatchObject({
        ok: true,
        rule: { reply_text: 'Hi' },
      })
    })

    it('holds a comment reply to the comment limit in characters, a direct message only to bytes', () => {
      const atLimit = 'x'.repeat(COMMENT_REPLY_MAX_CHARS)
      const over = 'x'.repeat(COMMENT_REPLY_MAX_CHARS + 1)
      expect(validateRuleForm(form({ applies_to: 'comment', reply_text: atLimit })).ok).toBe(true)
      expect(errorsOf(form({ applies_to: 'comment', reply_text: over })).reply_text).toMatch(
        /comment reply can be at most 300/,
      )
      expect(errorsOf(form({ applies_to: 'both', reply_text: over })).reply_text).toBeDefined()
      expect(validateRuleForm(form({ applies_to: 'dm', reply_text: over })).ok).toBe(true)
    })

    it('holds a direct message to the byte limit, not the character limit', () => {
      const atLimit = 'é'.repeat(DM_REPLY_MAX_BYTES / 2)
      expect(validateRuleForm(form({ applies_to: 'dm', reply_text: atLimit })).ok).toBe(true)
      const over = 'é'.repeat(DM_REPLY_MAX_BYTES / 2 + 1)
      expect(errorsOf(form({ applies_to: 'dm', reply_text: over })).reply_text).toMatch(/bytes/)
    })

    it('limits a private message in bytes and only on a rule that can send one', () => {
      const long = 'x'.repeat(DM_REPLY_MAX_BYTES + 1)
      expect(
        errorsOf(form({ applies_to: 'comment', private_reply_text: long })).private_reply_text,
      ).toMatch(/private message/)
      expect(
        validateRuleForm(
          form({ applies_to: 'comment', private_reply_text: 'x'.repeat(DM_REPLY_MAX_BYTES) }),
        ).ok,
      ).toBe(true)
      // A DM-only rule has no private message, so a leftover value is neither checked nor sent.
      expect(validateRuleForm(form({ applies_to: 'dm', private_reply_text: long }))).toMatchObject({
        ok: true,
        rule: { private_reply_text: null },
      })
    })

    it('sends a blank private message as none', () => {
      expect(
        validateRuleForm(form({ applies_to: 'both', private_reply_text: '  ' })),
      ).toMatchObject({
        ok: true,
        rule: { private_reply_text: null },
      })
    })
  })

  describe('a handoff rule', () => {
    it('needs a reason and sends no text', () => {
      const values = form({
        action: 'handoff',
        reply_text: 'ignored',
        private_reply_text: 'ignored',
      })
      expect(errorsOf(values).handoff_reason).toMatch(/Choose why/)
      expect(validateRuleForm({ ...values, handoff_reason: 'complaint' })).toMatchObject({
        ok: true,
        rule: {
          action: 'handoff',
          handoff_reason: 'complaint',
          reply_text: null,
          private_reply_text: null,
        },
      })
    })

    it('does not check reply text it will not send', () => {
      const values = form({
        action: 'handoff',
        handoff_reason: 'legal',
        reply_text: 'x'.repeat(5000),
      })
      expect(validateRuleForm(values).ok).toBe(true)
    })
  })

  describe('a skip rule', () => {
    it('sends nothing at all, whatever was typed before', () => {
      const values = form({
        action: 'skip',
        reply_text: 'old text',
        private_reply_text: 'old',
        handoff_reason: 'complaint',
      })
      expect(validateRuleForm(values)).toMatchObject({
        ok: true,
        rule: { action: 'skip', reply_text: null, private_reply_text: null, handoff_reason: null },
      })
    })
  })

  it('reports problems in several places at once', () => {
    const errors = errorsOf(form({ name: '', keywords: '', reply_text: '' }))
    expect(Object.keys(errors).sort()).toEqual(['keywords', 'name', 'reply_text'])
  })
})

describe('sameRuleInput', () => {
  const base = ruleToInput(rule())

  it('is true for the same rule', () => {
    expect(sameRuleInput(base, { ...base, keywords: [...base.keywords] })).toBe(true)
  })

  it.each<[string, Partial<typeof base>]>([
    ['name', { name: 'Other' }],
    ['enabled', { enabled: false }],
    ['channel', { applies_to: 'comment' }],
    ['match mode', { keyword_match: 'all' }],
    ['action', { action: 'skip' }],
    ['reply text', { reply_text: 'Different' }],
    ['private text', { private_reply_text: 'Private' }],
    ['reason', { handoff_reason: 'legal' }],
    ['a keyword', { keywords: ['delivery', 'post'] }],
    ['keyword order', { keywords: ['shipping', 'delivery'] }],
    ['the number of keywords', { keywords: ['delivery'] }],
  ])('notices a change to %s', (_name, change) => {
    expect(sameRuleInput(base, { ...base, ...change })).toBe(false)
  })
})
