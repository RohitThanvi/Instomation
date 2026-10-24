import { describe, expect, it } from 'vitest'
import { AI_LIMITS, type AiSettings } from '@/api/business'
import { aiPatch, aiToForm, validateAi, type AiForm, type Offered } from './ai-form'

function settings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    dm_automation_enabled: true,
    comment_automation_enabled: true,
    private_reply_enabled: false,
    confidence_threshold: 0.7,
    max_response_tokens: 300,
    temperature: 0.4,
    max_replies_per_conversation_per_hour: 10,
    ...overrides,
  }
}

const ALL: Offered = { dm: true, comments: true, privateReply: true }

function form(overrides: Partial<AiForm> = {}): AiForm {
  return { ...aiToForm(settings()), ...overrides }
}

describe('aiToForm', () => {
  it('shows the two fractions as whole percents and the counts as text', () => {
    expect(aiToForm(settings({ confidence_threshold: 0.55, temperature: 0.35 }))).toEqual({
      dm: true,
      comments: true,
      privateReply: false,
      confidence: 55,
      creativity: 35,
      maxTokens: '300',
      maxReplies: '10',
    })
  })
})

describe('rounding', () => {
  it('reads a fraction as the nearest whole percent, whatever float noise it carries', () => {
    // 0.29 * 100 is 28.999999999999996 and 0.57 * 100 is 56.99999999999999.
    const values = aiToForm(settings({ confidence_threshold: 0.29, temperature: 0.57 }))
    expect([values.confidence, values.creativity]).toEqual([29, 57])
    const current = settings({ confidence_threshold: 0.29, temperature: 0.57 })
    expect(aiPatch(current, values, ALL)).toEqual({})
  })
})

describe('validateAi', () => {
  it('accepts the bounds exactly', () => {
    for (const [maxTokens, maxReplies] of [
      [String(AI_LIMITS.tokens.min), String(AI_LIMITS.replies.min)],
      [String(AI_LIMITS.tokens.max), String(AI_LIMITS.replies.max)],
    ] as const) {
      expect(validateAi(form({ maxTokens, maxReplies }))).toEqual({})
    }
  })

  it.each(['', '  ', 'abc', '12.5', '49', '1001', '-100'])(
    'rejects %j as a reply length',
    (raw) => {
      expect(validateAi(form({ maxTokens: raw })).maxTokens).toBe(
        'Enter a whole number from 50 to 1000',
      )
    },
  )

  it.each(['', '0', '101', '2.5', 'x'])('rejects %j as replies per hour', (raw) => {
    expect(validateAi(form({ maxReplies: raw })).maxReplies).toBe(
      'Enter a whole number from 1 to 100',
    )
  })

  it('reports both when both are wrong', () => {
    expect(Object.keys(validateAi(form({ maxTokens: '1', maxReplies: '0' })))).toEqual([
      'maxTokens',
      'maxReplies',
    ])
  })
})

describe('aiPatch', () => {
  it('is empty when nothing changed, so there is nothing to send', () => {
    expect(aiPatch(settings(), form(), ALL)).toEqual({})
  })

  it('does not treat float noise as a change', () => {
    expect(
      aiPatch(settings({ confidence_threshold: 0.55 }), form({ confidence: 55 }), ALL),
    ).toEqual({})
  })

  it('sends only the fields that changed, with fractions and numbers', () => {
    const patch = aiPatch(
      settings(),
      form({ dm: false, confidence: 85, creativity: 10, maxTokens: '500', maxReplies: '20' }),
      ALL,
    )
    expect(patch).toEqual({
      dm_automation_enabled: false,
      confidence_threshold: 0.85,
      temperature: 0.1,
      max_response_tokens: 500,
      max_replies_per_conversation_per_hour: 20,
    })
  })

  it('turns private replies off together with comment replies', () => {
    const current = settings({ private_reply_enabled: true })
    const patch = aiPatch(current, form({ comments: false, privateReply: true }), ALL)
    expect(patch).toEqual({ comment_automation_enabled: false, private_reply_enabled: false })
  })

  it('turns private replies on only while comment replies are on', () => {
    expect(aiPatch(settings(), form({ privateReply: true }), ALL)).toEqual({
      private_reply_enabled: true,
    })
    const commentsOff = settings({ comment_automation_enabled: false })
    expect(aiPatch(commentsOff, form({ comments: false, privateReply: true }), ALL)).toEqual({})
  })

  it('leaves a switch alone when it is not offered', () => {
    const current = settings({ dm_automation_enabled: true, private_reply_enabled: true })
    const edited = form({ dm: false, comments: false, privateReply: false, maxTokens: '400' })
    const patch = aiPatch(current, edited, { dm: false, comments: false, privateReply: false })
    expect(patch).toEqual({ max_response_tokens: 400 })
  })
})
