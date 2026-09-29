import { describe, expect, it } from 'vitest'
import { OAUTH_REASON_MESSAGES, parseOAuthResult } from './oauth-result'

const parse = (query: string) => parseOAuthResult(new URLSearchParams(query))

// The complete list documented in docs/FRONTEND_HANDOVER.md.
const DOCUMENTED_REASONS = [
  'INVALID_OAUTH_STATE',
  'AUTHORIZATION_DENIED',
  'INSTAGRAM_ACCOUNT_NOT_PROFESSIONAL',
  'ACCOUNT_ALREADY_CONNECTED',
  'PERMISSION_DENIED',
  'INSTAGRAM_UNAVAILABLE',
  'INSTAGRAM_CONNECTION_FAILED',
  'INTERNAL_ERROR',
]

describe('parseOAuthResult', () => {
  it('has a specific message for every documented reason code', () => {
    expect(Object.keys(OAUTH_REASON_MESSAGES).sort()).toEqual([...DOCUMENTED_REASONS].sort())
    for (const reason of DOCUMENTED_REASONS) {
      const result = parse(`status=error&reason=${reason}`)
      expect(result).toMatchObject({ status: 'error', reason })
      expect(result?.status === 'error' && result.message).toBe(
        OAUTH_REASON_MESSAGES[reason as keyof typeof OAUTH_REASON_MESSAGES],
      )
    }
  })

  it('reports success', () => {
    expect(parse('status=connected')).toEqual({ status: 'connected' })
  })

  it('returns null when there is no usable outcome in the URL', () => {
    expect(parse('')).toBeNull()
    expect(parse('status=pending')).toBeNull()
  })

  it('falls back to a generic message for unknown or missing reasons', () => {
    for (const query of ['status=error', 'status=error&reason=SOMETHING_NEW']) {
      const result = parse(query)
      expect(result?.status === 'error' && result.message).toMatch(/could not connect/i)
    }
  })

  it('never echoes attacker-controlled query text into the page', () => {
    const result = parse(
      'status=error&reason=' + encodeURIComponent('<img src=x onerror=alert(1)>'),
    )
    expect(result).toMatchObject({ status: 'error', reason: 'UNKNOWN' })
    expect(JSON.stringify(result)).not.toContain('<img')
  })

  it('does not offer a retry when the cause is missing permission', () => {
    expect(parse('status=error&reason=PERMISSION_DENIED')).toMatchObject({ canRetry: false })
    expect(parse('status=error&reason=INSTAGRAM_UNAVAILABLE')).toMatchObject({ canRetry: true })
  })
})
