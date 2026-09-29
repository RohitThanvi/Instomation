import { describe, expect, it } from 'vitest'
import { buildCommitments, DEFAULT_AUTOMATION, normalizeAutomation } from './automation'
import { FEATURES } from '@/api/instagram'

const only =
  (...enabled: string[]) =>
  (feature: string) =>
    enabled.includes(feature)

describe('normalizeAutomation', () => {
  it('forces off any reply action the server has not enabled', () => {
    const all = {
      ...DEFAULT_AUTOMATION,
      reply_to_comments: true,
      reply_to_dms: true,
      private_reply_from_comments: true,
    }
    expect(normalizeAutomation(all, only(FEATURES.dmReply))).toMatchObject({
      reply_to_comments: false,
      reply_to_dms: true,
      private_reply_from_comments: false,
    })
  })

  it('leaves the handoff preferences untouched', () => {
    const custom = { ...DEFAULT_AUTOMATION, handoff_on_complaint: false }
    expect(normalizeAutomation(custom, only()).handoff_on_complaint).toBe(false)
  })
})

describe('buildCommitments', () => {
  it('only promises what is both chosen and enabled', () => {
    const { will } = buildCommitments(
      { ...DEFAULT_AUTOMATION, reply_to_comments: true, reply_to_dms: true },
      only(FEATURES.dmReply),
    )
    expect(will.join(' ')).toMatch(/message you first/i)
    expect(will.join(' ')).not.toMatch(/comments on your posts/i)
  })

  it('promises nothing before automation preferences exist', () => {
    expect(buildCommitments(undefined, only(FEATURES.commentReply)).will).toEqual([])
  })

  it('always states the hard limits and never mentions unsupported Instagram actions', () => {
    const { will, willNot } = buildCommitments(DEFAULT_AUTOMATION, only(...Object.values(FEATURES)))
    expect(willNot.join(' ')).toMatch(/password/i)
    expect(willNot.join(' ')).toMatch(/handed to a person/i)
    expect([...will, ...willNot].join(' ')).not.toMatch(
      /\blike\b|\bbio\b|profile photo|profile picture/i,
    )
  })
})
