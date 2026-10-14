import { describe, expect, it } from 'vitest'
import { buildCommitments, DEFAULT_AUTOMATION, normalizeAutomation } from './automation'
import { FEATURES } from '@/api/instagram'

const only =
  (...enabled: string[]) =>
  (feature: string) =>
    enabled.includes(feature)

describe('normalizeAutomation', () => {
  it('forces off any reply action the server has not enabled', () => {
    const all = { reply_to_comments: true, reply_to_dms: true }
    expect(normalizeAutomation(all, only(FEATURES.dmReply))).toEqual({
      reply_to_comments: false,
      reply_to_dms: true,
    })
  })

  it('gates each action on its own capability, in both directions', () => {
    const all = { reply_to_comments: true, reply_to_dms: true }
    expect(normalizeAutomation(all, only(FEATURES.commentReply))).toEqual({
      reply_to_comments: true,
      reply_to_dms: false,
    })
    expect(normalizeAutomation(all, only())).toEqual({
      reply_to_comments: false,
      reply_to_dms: false,
    })
  })

  it('keeps a reply action the server has enabled and the owner chose', () => {
    expect(
      normalizeAutomation(DEFAULT_AUTOMATION, only(FEATURES.commentReply, FEATURES.dmReply)),
    ).toEqual(DEFAULT_AUTOMATION)
  })

  it('never turns on something the owner switched off', () => {
    const off = { reply_to_comments: false, reply_to_dms: false }
    expect(normalizeAutomation(off, only(...Object.values(FEATURES)))).toEqual(off)
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

  it('describes handoffs only alongside a reply action, and never promises a private reply', () => {
    const none = buildCommitments(
      { reply_to_comments: false, reply_to_dms: false },
      only(...Object.values(FEATURES)),
    )
    expect(none.will).toEqual([])
    const some = buildCommitments(DEFAULT_AUTOMATION, only(...Object.values(FEATURES)))
    expect(some.will.join(' ')).toMatch(/hand a conversation to a person/i)
    expect(some.will.join(' ')).not.toMatch(/private|asks for one|sounds upset/i)
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
