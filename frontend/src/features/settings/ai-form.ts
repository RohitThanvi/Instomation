import { AI_LIMITS, type AiSettings, type AiSettingsPatch } from '@/api/business'

/** The assistant's settings as the form edits them. */
export interface AiForm {
  dm: boolean
  comments: boolean
  privateReply: boolean
  /** Whole percent: the share of confidence below which the assistant hands over to a person. */
  confidence: number
  /** Whole percent: how freely the assistant words its replies (the model temperature). */
  creativity: number
  maxTokens: string
  maxReplies: string
}

/** Which switches the plan and Instagram connection allow; a switch not offered is left alone. */
export interface Offered {
  dm: boolean
  comments: boolean
  privateReply: boolean
}

export interface AiErrors {
  maxTokens?: string
  maxReplies?: string
}

const toPercent = (fraction: number) => Math.round(fraction * 100)

export function aiToForm(settings: AiSettings): AiForm {
  return {
    dm: settings.dm_automation_enabled,
    comments: settings.comment_automation_enabled,
    privateReply: settings.private_reply_enabled,
    confidence: toPercent(settings.confidence_threshold),
    creativity: toPercent(settings.temperature),
    maxTokens: String(settings.max_response_tokens),
    maxReplies: String(settings.max_replies_per_conversation_per_hour),
  }
}

function wholeNumber(raw: string, min: number, max: number): string | undefined {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    return `Enter a whole number from ${String(min)} to ${String(max)}`
  }
  return undefined
}

/** Mirrors `AiSettingsUpdate`'s bounds. The two sliders cannot leave their range. */
export function validateAi(form: AiForm): AiErrors {
  const errors: AiErrors = {}
  const tokens = wholeNumber(form.maxTokens, AI_LIMITS.tokens.min, AI_LIMITS.tokens.max)
  if (tokens !== undefined) errors.maxTokens = tokens
  const replies = wholeNumber(form.maxReplies, AI_LIMITS.replies.min, AI_LIMITS.replies.max)
  if (replies !== undefined) errors.maxReplies = replies
  return errors
}

/**
 * Only what changed, since the server applies a partial update. Private replies only exist
 * alongside comment replies, so turning comments off also turns them off rather than leaving
 * them to resume unnoticed when comments come back. Run it on a form `validateAi` accepted.
 */
export function aiPatch(current: AiSettings, form: AiForm, offered: Offered): AiSettingsPatch {
  const patch: AiSettingsPatch = {}
  if (offered.dm && form.dm !== current.dm_automation_enabled) {
    patch.dm_automation_enabled = form.dm
  }
  if (offered.comments && form.comments !== current.comment_automation_enabled) {
    patch.comment_automation_enabled = form.comments
  }
  if (offered.privateReply) {
    const wanted = form.comments && form.privateReply
    if (wanted !== current.private_reply_enabled) patch.private_reply_enabled = wanted
  }
  if (form.confidence !== toPercent(current.confidence_threshold)) {
    patch.confidence_threshold = form.confidence / 100
  }
  if (form.creativity !== toPercent(current.temperature)) patch.temperature = form.creativity / 100
  const tokens = Number(form.maxTokens)
  if (tokens !== current.max_response_tokens) patch.max_response_tokens = tokens
  const replies = Number(form.maxReplies)
  if (replies !== current.max_replies_per_conversation_per_hour) {
    patch.max_replies_per_conversation_per_hour = replies
  }
  return patch
}
