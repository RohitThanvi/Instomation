import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { capabilitySchema, FEATURES, instagramAccountSchema, isFeatureEnabled } from './instagram'
import { CAPABILITIES_WIRE, accountWire } from '@/test/fixtures'

describe('instagram schemas', () => {
  it('parses the capabilities payload exactly as the backend sends it', () => {
    const parsed = z.array(capabilitySchema).parse(CAPABILITIES_WIRE)
    expect(parsed).toHaveLength(6)
  })

  it('parses an account and rejects an unknown status', () => {
    expect(instagramAccountSchema.parse(accountWire()).username).toBe('acme.studio')
    expect(instagramAccountSchema.safeParse(accountWire({ status: 'live' })).success).toBe(false)
  })
})

describe('isFeatureEnabled', () => {
  const capabilities = z.array(capabilitySchema).parse(CAPABILITIES_WIRE)

  it('uses the FEATURE_* ids from the server', () => {
    expect(isFeatureEnabled(capabilities, FEATURES.commentReply)).toBe(true)
    expect(isFeatureEnabled(capabilities, 'FEATURE_COMMENT_LIKE')).toBe(false)
  })

  it('treats unknown or absent features as disabled', () => {
    expect(isFeatureEnabled(capabilities, 'FEATURE_SOMETHING_NEW')).toBe(false)
    expect(isFeatureEnabled([], FEATURES.dmReply)).toBe(false)
  })
})
