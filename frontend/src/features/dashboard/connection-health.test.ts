import { describe, expect, it } from 'vitest'
import { summarizeConnectionHealth } from './connection-health'
import { instagramAccountSchema } from '@/api/instagram'
import { accountWire } from '@/test/fixtures'

const account = (overrides: Record<string, unknown> = {}) =>
  instagramAccountSchema.parse(accountWire(overrides))

describe('summarizeConnectionHealth', () => {
  it('has nothing to say when every account is live', () => {
    expect(summarizeConnectionHealth([account()])).toBeNull()
  })

  it('has nothing to say when there are no accounts (the card prompts to connect)', () => {
    expect(summarizeConnectionHealth([])).toBeNull()
  })

  it('ignores accounts the user disconnected on purpose', () => {
    expect(summarizeConnectionHealth([account({ status: 'disconnected' })])).toBeNull()
  })

  it('warns, naming the account, when a token has expired', () => {
    expect(summarizeConnectionHealth([account({ status: 'token_expired' })])).toMatchObject({
      tone: 'warning',
      title: 'Reconnect @acme.studio',
    })
  })

  it('counts accounts when several need reconnecting', () => {
    const expired = account({ status: 'token_expired' })
    const other = account({
      id: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d',
      username: 'second',
      status: 'token_expired',
    })
    expect(summarizeConnectionHealth([expired, other])?.title).toBe(
      '2 Instagram accounts need to be reconnected',
    )
  })

  it('puts an expired token ahead of a silent webhook', () => {
    const silent = account({
      id: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d',
      webhook_subscribed: false,
    })
    expect(summarizeConnectionHealth([silent, account({ status: 'token_expired' })])?.tone).toBe(
      'warning',
    )
  })

  it('flags an active account that is not receiving messages, without alarm', () => {
    expect(summarizeConnectionHealth([account({ webhook_subscribed: false })])).toMatchObject({
      tone: 'info',
      title: 'Instagram is not sending us messages yet',
    })
  })
})
