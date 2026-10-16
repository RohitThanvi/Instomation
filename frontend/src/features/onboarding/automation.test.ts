import { describe, expect, it } from 'vitest'
import { buildCommitments, DEFAULT_AUTOMATION, normalizeAutomation } from './automation'
import type { AutomationPreferences } from '@/api/business'
import { FEATURES } from '@/api/instagram'

const only =
  (...enabled: string[]) =>
  (feature: string) =>
    enabled.includes(feature)

const ALL = only(...Object.values(FEATURES))
const everything: AutomationPreferences = {
  reply_to_comments: true,
  reply_to_dms: true,
  private_reply_from_comments: true,
}
const nothing: AutomationPreferences = {
  reply_to_comments: false,
  reply_to_dms: false,
  private_reply_from_comments: false,
}

describe('normalizeAutomation', () => {
  it('forces off any reply action the server has not enabled', () => {
    expect(normalizeAutomation(everything, only(FEATURES.dmReply))).toEqual({
      ...nothing,
      reply_to_dms: true,
    })
  })

  it('gates each action on its own capability, in both directions', () => {
    expect(normalizeAutomation(everything, only(FEATURES.commentReply))).toEqual({
      ...nothing,
      reply_to_comments: true,
    })
    expect(normalizeAutomation(everything, only())).toEqual(nothing)
  })

  it('keeps a reply action the server has enabled and the owner chose', () => {
    expect(normalizeAutomation(DEFAULT_AUTOMATION, ALL)).toEqual(DEFAULT_AUTOMATION)
    expect(normalizeAutomation(everything, ALL)).toEqual(everything)
  })

  it('never turns on something the owner switched off', () => {
    expect(normalizeAutomation(nothing, ALL)).toEqual(nothing)
  })

  describe('private reply', () => {
    it('starts off, like on the server, so the owner has to opt in', () => {
      expect(DEFAULT_AUTOMATION.private_reply_from_comments).toBe(false)
    })

    it('needs its own capability, not just comment replies', () => {
      const withoutIt = only(FEATURES.commentReply, FEATURES.dmReply)
      expect(normalizeAutomation(everything, withoutIt).private_reply_from_comments).toBe(false)
      expect(normalizeAutomation(everything, withoutIt).reply_to_comments).toBe(true)
    })

    it('answers a comment, so it is off wherever comment replies are', () => {
      const ownerTurnedCommentsOff = { ...everything, reply_to_comments: false }
      expect(normalizeAutomation(ownerTurnedCommentsOff, ALL).private_reply_from_comments).toBe(
        false,
      )
      const serverTurnedCommentsOff = only(FEATURES.dmReply, FEATURES.privateReply)
      expect(
        normalizeAutomation(everything, serverTurnedCommentsOff).private_reply_from_comments,
      ).toBe(false)
    })

    it('stays on when the owner chose it and both capabilities are enabled', () => {
      expect(normalizeAutomation(everything, ALL).private_reply_from_comments).toBe(true)
    })
  })
})

describe('buildCommitments', () => {
  it('only promises what is both chosen and enabled', () => {
    const { will } = buildCommitments(everything, only(FEATURES.dmReply))
    expect(will.join(' ')).toMatch(/message you first/i)
    expect(will.join(' ')).not.toMatch(/comments on your posts|private message/i)
  })

  it('describes handoffs only alongside a reply action', () => {
    expect(buildCommitments(nothing, ALL).will).toEqual([])
    const some = buildCommitments(DEFAULT_AUTOMATION, ALL)
    expect(some.will.join(' ')).toMatch(/hand a conversation to a person/i)
    expect(some.will.join(' ')).not.toMatch(/asks for one|sounds upset/i)
  })

  it('promises a private message only when it is on', () => {
    expect(buildCommitments(DEFAULT_AUTOMATION, ALL).will.join(' ')).not.toMatch(/private/i)
    expect(buildCommitments(everything, ALL).will.join(' ')).toMatch(
      /one private message when the answer needs more detail/i,
    )
    // Chosen, but the server does not offer it: no promise.
    expect(
      buildCommitments(everything, only(FEATURES.commentReply, FEATURES.dmReply)).will.join(' '),
    ).not.toMatch(/private/i)
  })

  it('promises nothing before automation preferences exist', () => {
    expect(buildCommitments(undefined, only(FEATURES.commentReply)).will).toEqual([])
  })

  it('always states the hard limits and never mentions unsupported Instagram actions', () => {
    const { will, willNot } = buildCommitments(everything, ALL)
    expect(willNot.join(' ')).toMatch(/password/i)
    expect(willNot.join(' ')).toMatch(/handed to a person/i)
    expect([...will, ...willNot].join(' ')).not.toMatch(
      /\blike\b|\bbio\b|profile photo|profile picture/i,
    )
  })
})
