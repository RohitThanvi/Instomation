import { describe, expect, it } from 'vitest'
import { INBOX_LIST_REFETCH_MS } from '@/config/constants'
import { handoffKeys } from './handoff-keys'
import { handoffPollInterval } from './use-handoffs'

describe('handoff polling', () => {
  it('refreshes the waiting queue like the inbox, and leaves resolved history alone', () => {
    expect(handoffPollInterval('waiting')).toBe(INBOX_LIST_REFETCH_MS)
    expect(handoffPollInterval('resolved')).toBe(false)
  })
})

describe('handoff query keys', () => {
  it('keep each view and each organization apart, under one prefix that clears them all', () => {
    const waiting = handoffKeys.list('org-a', 'waiting')
    expect(waiting).not.toEqual(handoffKeys.list('org-a', 'resolved'))
    expect(waiting).not.toEqual(handoffKeys.list('org-b', 'waiting'))
    for (const key of [waiting, handoffKeys.counts('org-a')]) {
      expect(key.slice(0, handoffKeys.all('org-a').length)).toEqual(handoffKeys.all('org-a'))
    }
  })
})
