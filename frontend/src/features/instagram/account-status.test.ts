import { describe, expect, it } from 'vitest'
import { describeAccount } from './account-status'
import { instagramAccountSchema } from '@/api/instagram'
import { accountWire } from '@/test/fixtures'

const describeWire = (overrides: Record<string, unknown>) =>
  describeAccount(instagramAccountSchema.parse(accountWire(overrides)))

describe('describeAccount', () => {
  it('is live only when active AND receiving webhooks', () => {
    expect(describeWire({})).toMatchObject({ label: 'Connected', isLive: true })
  })

  it('shows "reconnect required" for an expired token and is never live', () => {
    expect(describeWire({ status: 'token_expired' })).toMatchObject({
      label: 'Reconnect required',
      isLive: false,
      needsReconnect: true,
    })
  })

  it('says messages are not arriving yet when the webhook is not subscribed', () => {
    expect(describeWire({ webhook_subscribed: false })).toMatchObject({
      label: 'Not receiving messages yet',
      isLive: false,
    })
  })

  it('treats a disconnected account as not live, even if the webhook flag is set', () => {
    expect(describeWire({ status: 'disconnected' })).toMatchObject({
      label: 'Disconnected',
      isLive: false,
    })
  })

  it('prioritises an expired token over an unsubscribed webhook', () => {
    expect(describeWire({ status: 'token_expired', webhook_subscribed: false }).label).toBe(
      'Reconnect required',
    )
  })
})
