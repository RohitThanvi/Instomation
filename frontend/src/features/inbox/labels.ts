import type { BadgeTone } from '@/components/ui/badge'
import type {
  Conversation,
  ConversationState,
  Customer,
  DeliveryStatus,
  Intent,
  Priority,
} from '@/api/conversations'
import type { MemberRole } from '@/api/schemas'

export const STATE_LABELS: Record<ConversationState, string> = {
  ai_active: 'Assistant replying',
  human_required: 'Needs a person',
  human_active: 'With your team',
  resolved: 'Resolved',
}

export const STATE_TONES: Record<ConversationState, BadgeTone> = {
  ai_active: 'neutral',
  human_required: 'warning',
  human_active: 'info',
  resolved: 'success',
}

export const STATE_DESCRIPTIONS: Record<ConversationState, string> = {
  ai_active: 'New messages are answered automatically. Take over to reply yourself.',
  human_required: 'The assistant has stopped replying here and is waiting for a person.',
  human_active: 'Your team is handling this. The assistant stays quiet until you hand it back.',
  resolved: 'This conversation is closed. Reopen it to reply.',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
}

export const INTENT_LABELS: Record<Intent, string> = {
  greeting: 'Greeting',
  product_query: 'Product question',
  price_query: 'Price question',
  service_query: 'Service question',
  order_query: 'Order question',
  shipping_query: 'Shipping question',
  booking_query: 'Booking request',
  collaboration: 'Collaboration',
  sponsorship: 'Sponsorship',
  affiliate: 'Affiliate request',
  complaint: 'Complaint',
  support: 'Support request',
  general_question: 'General question',
  positive_comment: 'Positive feedback',
  negative_comment: 'Negative feedback',
  spam: 'Spam',
  sexual: 'Inappropriate content',
  offensive: 'Offensive content',
  harassment: 'Harassment',
  uncertain: 'Unclear',
  human_required: 'Needs a person',
}

/** Mirrors the server: only these states let a person send a reply (`is_ai_silenced`). */
export function canReplyIn(state: ConversationState): boolean {
  return state === 'human_required' || state === 'human_active'
}

export interface ComposerAvailability {
  canReply: boolean
  /** Why replying is unavailable, or `null` when it is available. */
  reason: string | null
}

/**
 * A reply needs both a human-controlled conversation and Instagram message sending to be on:
 * with it off the server accepts the reply but suppresses delivery, so the UI blocks it up front.
 */
export function composerAvailability(
  state: ConversationState,
  messageSendingEnabled: boolean,
): ComposerAvailability {
  if (state === 'ai_active') {
    return {
      canReply: false,
      reason: 'The assistant is replying here. Take over to send a message yourself.',
    }
  }
  if (state === 'resolved') {
    return {
      canReply: false,
      reason: 'This conversation is resolved. Reopen it to send a message.',
    }
  }
  if (!messageSendingEnabled) {
    return {
      canReply: false,
      reason:
        'Sending messages is turned off for this workspace right now, so replies cannot be delivered.',
    }
  }
  return { canReply: true, reason: null }
}

export type ConversationAction = 'takeover' | 'hand_back' | 'resolve'

export const ACTION_COPY: Record<ConversationAction, { label: string; pending: string }> = {
  takeover: { label: 'Take over', pending: 'Taking over' },
  hand_back: { label: 'Hand back to assistant', pending: 'Handing back' },
  resolve: { label: 'Mark resolved', pending: 'Resolving' },
}

/** Which state changes make sense from each state (the server itself accepts any). */
export function availableActions(state: ConversationState): ConversationAction[] {
  switch (state) {
    case 'ai_active':
    case 'human_required':
      return ['takeover', 'resolve']
    case 'human_active':
      return ['hand_back', 'resolve']
    case 'resolved':
      return ['takeover']
  }
}

/** A resolved conversation is reopened by taking it over. */
export function actionLabel(action: ConversationAction, state: ConversationState): string {
  return action === 'takeover' && state === 'resolved'
    ? 'Reopen and take over'
    : ACTION_COPY[action].label
}

export function customerName(customer: Customer): string {
  return customer.display_name ?? customer.username ?? 'Instagram user'
}

export function customerHandle(customer: Customer): string | null {
  return customer.username === null ? null : `@${customer.username}`
}

/** Whether a name already includes the handle, so it is not shown twice. */
export function showsHandleSeparately(customer: Customer): boolean {
  return customer.display_name !== null && customer.username !== null
}

/**
 * The browser cannot resolve user ids to people (the member list needs `members_manage`), so
 * the only person we can name is "you": staff see only conversations assigned to them.
 */
export function assigneeLabel(role: MemberRole, conversation: Conversation): string {
  if (conversation.assigned_user_id === null) return 'Unassigned'
  return role === 'staff' ? 'You' : 'A team member'
}

/** Percentage text, only for values that are valid probabilities. */
export function confidenceLabel(value: number | null): string | null {
  if (value === null || value < 0 || value > 1) return null
  return `${Math.round(value * 100)}% confident`
}

export interface DeliveryNotice {
  label: string
  tone: BadgeTone
  detail?: string
}

/** Delivery states worth surfacing on an outbound message; `sent` and `received` need no caption. */
export function deliveryNotice(status: DeliveryStatus): DeliveryNotice | null {
  switch (status) {
    case 'pending':
      return { label: 'Sending', tone: 'neutral' }
    case 'failed':
      return {
        label: 'Not delivered',
        tone: 'danger',
        detail:
          'Instagram did not accept this message. Check that your Instagram connection is active; Instagram also only allows replies for a limited time after the customer last wrote.',
      }
    case 'suppressed':
      return {
        label: 'Not sent',
        tone: 'warning',
        detail:
          'Sending messages was turned off for this workspace, so this message was held back.',
      }
    case 'sent':
    case 'received':
      return null
  }
}
