import { z } from 'zod'

/** Every `reason` the backend documents for `?status=error`. */
export const OAUTH_REASON_MESSAGES = {
  INVALID_OAUTH_STATE: 'That connection attempt expired or was already used. Please start again.',
  AUTHORIZATION_DENIED:
    'Instagram access was not granted. Connect again and approve the permissions, so the assistant can read and reply to your messages and comments.',
  INSTAGRAM_ACCOUNT_NOT_PROFESSIONAL:
    'That is a personal Instagram account. Switch it to a Business or Creator account in Instagram’s settings, then connect again.',
  ACCOUNT_ALREADY_CONNECTED:
    'That Instagram account is already connected to a different workspace.',
  PERMISSION_DENIED:
    'You do not have permission to connect accounts in this workspace. Ask an owner or admin to do it.',
  INSTAGRAM_UNAVAILABLE:
    'Instagram is not responding right now. Please try again in a few minutes.',
  INSTAGRAM_CONNECTION_FAILED: 'We could not finish connecting to Instagram. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
} as const satisfies Record<string, string>

const FALLBACK_MESSAGE = 'We could not connect your Instagram account. Please try again.'
const REASON_SHAPE = /^[A-Z][A-Z_]{0,59}$/

export type OAuthResult =
  { status: 'connected' } | { status: 'error'; reason: string; message: string; canRetry: boolean }

const paramsSchema = z.object({
  status: z.enum(['connected', 'error']),
  reason: z.string().nullable(),
})

function isKnownReason(reason: string): reason is keyof typeof OAUTH_REASON_MESSAGES {
  return Object.hasOwn(OAUTH_REASON_MESSAGES, reason)
}

/** Returns null when the URL carries no (valid) OAuth outcome. Query text is never shown verbatim. */
export function parseOAuthResult(params: URLSearchParams): OAuthResult | null {
  const parsed = paramsSchema.safeParse({
    status: params.get('status'),
    reason: params.get('reason'),
  })
  if (!parsed.success) return null
  if (parsed.data.status === 'connected') return { status: 'connected' }

  const rawReason = parsed.data.reason
  const reason = rawReason !== null && REASON_SHAPE.test(rawReason) ? rawReason : 'UNKNOWN'
  return {
    status: 'error',
    reason,
    message: isKnownReason(reason) ? OAUTH_REASON_MESSAGES[reason] : FALLBACK_MESSAGE,
    // Retrying cannot fix a missing permission.
    canRetry: reason !== 'PERMISSION_DENIED',
  }
}
