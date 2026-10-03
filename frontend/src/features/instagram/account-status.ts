import type { InstagramAccount } from '@/api/instagram'
import type { BadgeTone } from '@/components/ui/badge'

export interface AccountStatusView {
  tone: BadgeTone
  label: string
  detail: string
  /** True only when the assistant can actually receive and answer messages. */
  isLive: boolean
  needsReconnect: boolean
}

export function describeAccount(account: InstagramAccount): AccountStatusView {
  if (account.status === 'token_expired') {
    return {
      tone: 'warning',
      label: 'Reconnect required',
      detail: 'Instagram access has expired. Reconnect so the assistant can work again.',
      isLive: false,
      needsReconnect: true,
    }
  }
  if (account.status === 'disconnected') {
    return {
      tone: 'neutral',
      label: 'Disconnected',
      detail: 'This account is disconnected. Connect it again to resume.',
      isLive: false,
      needsReconnect: false,
    }
  }
  if (!account.webhook_subscribed) {
    return {
      tone: 'warning',
      label: 'Not receiving messages yet',
      detail:
        'The account is connected, but Instagram is not sending us its messages and comments yet.',
      isLive: false,
      needsReconnect: false,
    }
  }
  return {
    tone: 'success',
    label: 'Connected',
    detail: 'Messages and comments from this account are reaching Instomation.',
    isLive: true,
    needsReconnect: false,
  }
}
