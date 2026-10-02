import type { InstagramAccount } from '@/api/instagram'
import { describeAccount } from '@/features/instagram/account-status'

export interface ConnectionHealth {
  tone: 'warning' | 'info'
  title: string
  detail: string
}

/**
 * The one thing about the Instagram connection worth interrupting the dashboard for.
 * Deliberately disconnected accounts are not "attention"; having no account is handled
 * by the connection card's call to action.
 */
export function summarizeConnectionHealth(
  accounts: readonly InstagramAccount[],
): ConnectionHealth | null {
  const current = accounts.filter((account) => account.status !== 'disconnected')

  const expired = current.filter((account) => describeAccount(account).needsReconnect)
  if (expired.length > 0) {
    const [only] = expired
    return {
      tone: 'warning',
      title:
        expired.length === 1 && only !== undefined
          ? `Reconnect @${only.username}`
          : `${expired.length} Instagram accounts need to be reconnected`,
      detail:
        'Instagram access has expired, so the assistant cannot read or answer messages until you reconnect.',
    }
  }

  const silent = current.filter((account) => !describeAccount(account).isLive)
  if (silent.length > 0) {
    return {
      tone: 'info',
      title: 'Instagram is not sending us messages yet',
      detail:
        'Your account is connected, but messages and comments are not reaching Instomation. This usually resolves on its own; reconnecting can help if it does not.',
    }
  }
  return null
}
