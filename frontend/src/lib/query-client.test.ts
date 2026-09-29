import { describe, expect, it } from 'vitest'
import { ApiError, CLIENT_ERROR_CODES, SERVER_ERROR_CODES } from '@/api/errors'
import { shouldRetry } from './query-client'

describe('shouldRetry', () => {
  it('retries network and auth-provider outages a bounded number of times', () => {
    const network = new ApiError(0, CLIENT_ERROR_CODES.network, 'offline')
    const provider = new ApiError(503, SERVER_ERROR_CODES.authProviderUnavailable, 'later')
    expect(shouldRetry(0, network)).toBe(true)
    expect(shouldRetry(1, provider)).toBe(true)
    expect(shouldRetry(2, network)).toBe(false)
  })

  it('never retries client errors or unknown failures', () => {
    expect(shouldRetry(0, new ApiError(403, SERVER_ERROR_CODES.permissionDenied, 'no'))).toBe(false)
    expect(shouldRetry(0, new Error('boom'))).toBe(false)
  })
})
