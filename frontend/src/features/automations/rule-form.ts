import {
  RULE_LIMITS,
  type KeywordMatch,
  type Rule,
  type RuleAction,
  type RuleInput,
  type RuleScope,
} from '@/api/automations'
import type { HandoffReason } from '@/api/handoffs'
import { COMMENT_REPLY_MAX_CHARS, DM_REPLY_MAX_BYTES } from '@/config/constants'

/** A rule as the editor holds it: keywords are one per line, and every text is a plain string. */
export interface RuleForm {
  name: string
  enabled: boolean
  applies_to: RuleScope
  keywords: string
  keyword_match: KeywordMatch
  action: RuleAction
  reply_text: string
  private_reply_text: string
  handoff_reason: HandoffReason | ''
}

export type RuleField = 'name' | 'keywords' | 'reply_text' | 'private_reply_text' | 'handoff_reason'
export type RuleErrors = Partial<Record<RuleField, string>>
export type RuleResult = { ok: true; rule: RuleInput } | { ok: false; errors: RuleErrors }

export function emptyRuleForm(): RuleForm {
  return {
    name: '',
    enabled: true,
    applies_to: 'both',
    keywords: '',
    keyword_match: 'any',
    action: 'reply',
    reply_text: '',
    private_reply_text: '',
    handoff_reason: '',
  }
}

export function ruleToForm(rule: Rule): RuleForm {
  return {
    name: rule.name,
    enabled: rule.enabled,
    applies_to: rule.applies_to,
    keywords: rule.keywords.join('\n'),
    keyword_match: rule.keyword_match,
    action: rule.action,
    reply_text: rule.reply_text ?? '',
    private_reply_text: rule.private_reply_text ?? '',
    handoff_reason: rule.handoff_reason ?? '',
  }
}

/** What would be sent to change nothing: the rule as the server stores it. */
export function ruleToInput(rule: Rule): RuleInput {
  return {
    name: rule.name,
    enabled: rule.enabled,
    applies_to: rule.applies_to,
    keywords: rule.keywords,
    keyword_match: rule.keyword_match,
    action: rule.action,
    reply_text: rule.reply_text,
    private_reply_text: rule.private_reply_text,
    handoff_reason: rule.handoff_reason,
  }
}

const tidy = (text: string) => text.split(/\s+/).filter(Boolean).join(' ')
const fold = (text: string) => text.normalize('NFKC').toLowerCase()
/** Characters as the server counts them (code points), not UTF-16 units. */
const characters = (text: string) => Array.from(text).length
const bytes = (text: string) => new TextEncoder().encode(text).length

/** One keyword per line, whitespace tidied, blanks dropped, and a repeat (ignoring case and width) kept once. */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const line of text.split('\n')) {
    const keyword = tidy(line)
    if (keyword === '' || seen.has(fold(keyword))) continue
    seen.add(fold(keyword))
    keywords.push(keyword)
  }
  return keywords
}

function textErrors(form: RuleForm, errors: RuleErrors): void {
  const reply = form.reply_text.trim()
  if (reply === '') {
    errors.reply_text = 'Write the reply that should be sent'
  } else if (form.applies_to !== 'dm' && characters(reply) > COMMENT_REPLY_MAX_CHARS) {
    errors.reply_text = `A comment reply can be at most ${String(COMMENT_REPLY_MAX_CHARS)} characters (this is ${String(characters(reply))})`
  } else if (bytes(reply) > DM_REPLY_MAX_BYTES) {
    errors.reply_text = `A direct message can be at most ${String(DM_REPLY_MAX_BYTES)} bytes (this is ${String(bytes(reply))}; accented and non-Latin letters take more than one)`
  }
  const priv = form.private_reply_text.trim()
  if (form.applies_to !== 'dm' && bytes(priv) > DM_REPLY_MAX_BYTES) {
    errors.private_reply_text = `A private message can be at most ${String(DM_REPLY_MAX_BYTES)} bytes (this is ${String(bytes(priv))})`
  }
}

/** Mirrors `RuleIn` and the server's text limits, so the server rarely has to refuse. */
export function validateRuleForm(form: RuleForm): RuleResult {
  const errors: RuleErrors = {}
  const name = tidy(form.name)
  if (name === '') errors.name = 'Give the rule a name'
  else if (characters(name) > RULE_LIMITS.name) {
    errors.name = `Keep the name under ${String(RULE_LIMITS.name)} characters`
  }

  const keywords = parseKeywords(form.keywords)
  const tooLong = keywords.find((keyword) => characters(keyword) > RULE_LIMITS.keyword)
  if (keywords.length === 0) errors.keywords = 'Add at least one keyword or phrase'
  else if (keywords.length > RULE_LIMITS.keywords) {
    errors.keywords = `Use at most ${String(RULE_LIMITS.keywords)} keywords (you have ${String(keywords.length)})`
  } else if (tooLong !== undefined) {
    errors.keywords = `“${tooLong.slice(0, 20)}…” is longer than ${String(RULE_LIMITS.keyword)} characters`
  }

  if (form.action === 'reply') textErrors(form, errors)
  if (form.action === 'handoff' && form.handoff_reason === '') {
    errors.handoff_reason = 'Choose why this goes to a person'
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const reply = form.action === 'reply'
  const priv = form.private_reply_text.trim()
  return {
    ok: true,
    rule: {
      name,
      enabled: form.enabled,
      applies_to: form.applies_to,
      keywords,
      keyword_match: form.keyword_match,
      action: form.action,
      reply_text: reply ? form.reply_text.trim() : null,
      private_reply_text: reply && form.applies_to !== 'dm' && priv !== '' ? priv : null,
      handoff_reason:
        form.action === 'handoff' && form.handoff_reason !== '' ? form.handoff_reason : null,
    },
  }
}

export function sameRuleInput(a: RuleInput, b: RuleInput): boolean {
  return (
    a.name === b.name &&
    a.enabled === b.enabled &&
    a.applies_to === b.applies_to &&
    a.keyword_match === b.keyword_match &&
    a.action === b.action &&
    a.reply_text === b.reply_text &&
    a.private_reply_text === b.private_reply_text &&
    a.handoff_reason === b.handoff_reason &&
    a.keywords.length === b.keywords.length &&
    a.keywords.every((keyword, index) => keyword === b.keywords[index])
  )
}
