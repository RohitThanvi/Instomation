import type { Message } from '@/api/conversations'
import { PENDING_MESSAGE_REFETCH_MS, THREAD_REFETCH_MS } from '@/config/constants'

/** Poll faster while an outbound message is still waiting to be delivered. */
export function threadPollInterval(messages: readonly Message[] | undefined): number {
  const waiting = messages?.some((message) => message.status === 'pending') ?? false
  return waiting ? PENDING_MESSAGE_REFETCH_MS : THREAD_REFETCH_MS
}
