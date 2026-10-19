import { describe, expect, it } from 'vitest'
import { HANDOFF_REASONS, HANDOFF_STATUSES } from '@/api/handoffs'
import { REASON_LABELS, REASON_TONES, STATUS_LABELS, STATUS_TONES } from './labels'

describe('handoff labels', () => {
  it('give every reason a readable label and a tone', () => {
    for (const reason of HANDOFF_REASONS) {
      expect(REASON_LABELS[reason].length).toBeGreaterThan(0)
      expect(REASON_LABELS[reason]).not.toContain('_')
      expect(REASON_TONES[reason]).toBeDefined()
    }
  })

  it('give every status a label and a tone', () => {
    for (const status of HANDOFF_STATUSES) {
      expect(STATUS_LABELS[status].length).toBeGreaterThan(0)
      expect(STATUS_TONES[status]).toBeDefined()
    }
  })

  it('keeps the labels distinct, so two reasons are never confused on screen', () => {
    expect(new Set(Object.values(REASON_LABELS)).size).toBe(HANDOFF_REASONS.length)
  })
})
