import { z } from 'zod'

export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
})

/** Codes produced by the browser, never by the server. */
export const CLIENT_ERROR_CODES = {
  network: 'NETWORK_ERROR',
  invalidResponse: 'INVALID_RESPONSE',
  unexpected: 'UNEXPECTED_RESPONSE',
  noSession: 'NO_SESSION',
} as const

export const SERVER_ERROR_CODES = {
  unauthenticated: 'UNAUTHENTICATED',
  authProviderUnavailable: 'AUTH_PROVIDER_UNAVAILABLE',
  permissionDenied: 'PERMISSION_DENIED',
  organizationRequired: 'ORGANIZATION_REQUIRED',
  organizationAccessDenied: 'ORGANIZATION_ACCESS_DENIED',
  memberNotFound: 'MEMBER_NOT_FOUND',
  lastOwner: 'LAST_OWNER',
  invalidCursor: 'INVALID_CURSOR',
  validation: 'VALIDATION_ERROR',
  instagramAccountNotFound: 'INSTAGRAM_ACCOUNT_NOT_FOUND',
  internal: 'INTERNAL_ERROR',
} as const

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get isRetryable(): boolean {
    return (
      this.code === CLIENT_ERROR_CODES.network ||
      this.code === SERVER_ERROR_CODES.authProviderUnavailable
    )
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

export function hasErrorCode(value: unknown, code: string): boolean {
  return isApiError(value) && value.code === code
}

/** Message safe to show to a person: the server's own message, or a plain fallback. */
export function errorMessage(value: unknown): string {
  if (isApiError(value)) return value.message
  return 'Something went wrong. Please try again.'
}
