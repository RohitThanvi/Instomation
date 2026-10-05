import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_STATES,
  INTENTS,
  PRIORITIES,
  type ConversationState,
} from '@/api/conversations'
import { initialsOf } from '@/lib/initials'
import {
  actionLabel,
  assigneeLabel,
  availableActions,
  canReplyIn,
  composerAvailability,
  confidenceLabel,
  customerHandle,
  customerName,
  deliveryNotice,
  INTENT_LABELS,
  PRIORITY_LABELS,
  STATE_DESCRIPTIONS,
  STATE_LABELS,
  STATE_TONES,
} from './labels'
import { conversationSchema } from '@/api/conversations'
import { conversationWire, TEAMMATE_ID } from '@/test/fixtures'

const conversation = (overrides: Record<string, unknown> = {}) =>
  conversationSchema.parse(conversationWire(overrides))

describe('copy coverage', () => {
  it('has a label for every state, priority and intent the backend can send', () => {
    for (const state of CONVERSATION_STATES) {
      expect(STATE_LABELS[state]).toBeTruthy()
      expect(STATE_TONES[state]).toBeTruthy()
      expect(STATE_DESCRIPTIONS[state]).toBeTruthy()
    }
    for (const priority of PRIORITIES) expect(PRIORITY_LABELS[priority]).toBeTruthy()
    for (const intent of INTENTS) expect(INTENT_LABELS[intent]).toBeTruthy()
  })
})

describe('who can reply (mirrors the server rule)', () => {
  it.each([
    ['ai_active', false],
    ['human_required', true],
    ['human_active', true],
    ['resolved', false],
  ] as const)('%s -> canReply %s', (state, expected) => {
    expect(canReplyIn(state)).toBe(expected)
  })

  it('explains why the assistant-controlled and resolved states cannot be replied to', () => {
    expect(composerAvailability('ai_active', true)).toMatchObject({ canReply: false })
    expect(composerAvailability('ai_active', true).reason).toMatch(/take over/i)
    expect(composerAvailability('resolved', true).reason).toMatch(/reopen/i)
  })

  it('allows replies in human states while sending is on', () => {
    for (const state of ['human_required', 'human_active'] as const) {
      expect(composerAvailability(state, true)).toEqual({ canReply: true, reason: null })
    }
  })

  it('blocks replies, with a reason, when message sending is switched off', () => {
    const result = composerAvailability('human_active', false)
    expect(result.canReply).toBe(false)
    expect(result.reason).toMatch(/turned off/i)
  })
})

describe('conversation actions', () => {
  it.each([
    ['ai_active', ['takeover', 'resolve']],
    ['human_required', ['takeover', 'resolve']],
    ['human_active', ['hand_back', 'resolve']],
    ['resolved', ['takeover']],
  ] as [ConversationState, string[]][])('offers the right actions from %s', (state, expected) => {
    expect(availableActions(state)).toEqual(expected)
  })

  it('calls taking over a resolved conversation "reopen"', () => {
    expect(actionLabel('takeover', 'resolved')).toBe('Reopen and take over')
    expect(actionLabel('takeover', 'ai_active')).toBe('Take over')
  })
})

describe('people', () => {
  const customer = conversation().customer

  it('prefers the display name, then the handle, then a neutral fallback', () => {
    expect(customerName(customer)).toBe('Maya Kapoor')
    expect(customerName({ ...customer, display_name: null })).toBe('maya.k')
    expect(customerName({ ...customer, display_name: null, username: null })).toBe('Instagram user')
  })

  it('formats the handle with @ only when there is one', () => {
    expect(customerHandle(customer)).toBe('@maya.k')
    expect(customerHandle({ ...customer, username: null })).toBeNull()
  })

  it('only names the assignee when it is certainly the viewer', () => {
    const assigned = conversation({ assigned_user_id: TEAMMATE_ID })
    expect(assigneeLabel('staff', assigned)).toBe('You')
    expect(assigneeLabel('manager', assigned)).toBe('A team member')
    expect(assigneeLabel('owner', conversation())).toBe('Unassigned')
  })

  it('builds initials from names and handles', () => {
    expect(initialsOf('Maya Kapoor')).toBe('MK')
    expect(initialsOf('@maya.k')).toBe('MK')
    expect(initialsOf('single')).toBe('S')
    expect(initialsOf('')).toBe('?')
  })
})

describe('message metadata', () => {
  it('shows confidence only for valid probabilities', () => {
    expect(confidenceLabel(0.92)).toBe('92% confident')
    expect(confidenceLabel(0)).toBe('0% confident')
    expect(confidenceLabel(92)).toBeNull()
    expect(confidenceLabel(-0.1)).toBeNull()
    expect(confidenceLabel(null)).toBeNull()
  })

  it('captions only the delivery states that need attention', () => {
    expect(deliveryNotice('sent')).toBeNull()
    expect(deliveryNotice('received')).toBeNull()
    expect(deliveryNotice('pending')).toMatchObject({ label: 'Sending' })
    expect(deliveryNotice('failed')).toMatchObject({ label: 'Not delivered', tone: 'danger' })
    expect(deliveryNotice('suppressed')).toMatchObject({ label: 'Not sent', tone: 'warning' })
    expect(deliveryNotice('failed')?.detail).toMatch(/connection/i)
  })
})
