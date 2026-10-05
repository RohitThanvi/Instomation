import { InboxPage } from '@/features/inbox/inbox-page'
import type { MemberRole } from '@/api/schemas'
import {
  CAPABILITIES_WIRE,
  CONVERSATION_ID,
  TEAMMATE_ID,
  conversationWire,
  messageWire,
  organization,
} from './fixtures'
import { installMockApi, type RecordedCall } from './mock-api'
import { renderWithSession } from './render-app'

export type ConversationWire = ReturnType<typeof conversationWire>
export type MessageWire = ReturnType<typeof messageWire>
type Handlers = Parameters<typeof installMockApi>[0]

export const CONVERSATIONS_PATH = '/api/v1/conversations'
export const CONVERSATION_PATH = `${CONVERSATIONS_PATH}/${CONVERSATION_ID}`

export function errorBody(code: string, message: string) {
  return { error: { code, message } }
}

export function bodyText(call: RecordedCall): string {
  return (call.body as { body: string }).body
}

export function requestsTo(calls: readonly RecordedCall[], method: string, path: string) {
  return calls.filter((call) => call.method === method && call.path === path)
}

/**
 * A tiny in-memory inbox that behaves like `backend/app/api/v1/conversations.py` for one
 * conversation: actions change its state and replies/notes append to the thread. Tests can
 * mutate `conversation` and `messages` directly to simulate the world moving on.
 */
export class FakeInbox {
  conversation: ConversationWire
  messages: MessageWire[]

  constructor(overrides: Record<string, unknown> = {}, messages: MessageWire[] = [messageWire()]) {
    this.conversation = conversationWire(overrides)
    this.messages = messages
  }

  private change(patch: Record<string, unknown>) {
    this.conversation = { ...this.conversation, ...patch }
    return { body: this.conversation }
  }

  handlers(): Handlers {
    return {
      [`GET ${CONVERSATIONS_PATH}`]: () => ({
        body: { items: [this.conversation], next_cursor: null },
      }),
      [`GET ${CONVERSATION_PATH}`]: () => ({ body: this.conversation }),
      [`GET ${CONVERSATION_PATH}/messages`]: () => ({
        body: { items: this.messages, next_cursor: null },
      }),
      [`PATCH ${CONVERSATION_PATH}`]: (call) => this.change(call.body as Record<string, unknown>),
      [`POST ${CONVERSATION_PATH}/takeover`]: () =>
        this.change({ state: 'human_active', assigned_user_id: TEAMMATE_ID }),
      [`POST ${CONVERSATION_PATH}/hand-back`]: () => this.change({ state: 'ai_active' }),
      [`POST ${CONVERSATION_PATH}/resolve`]: () => this.change({ state: 'resolved' }),
      [`POST ${CONVERSATION_PATH}/messages`]: (call) => {
        const message = messageWire({
          direction: 'outbound',
          origin: 'human',
          body: bodyText(call),
          status: 'pending',
          author_user_id: TEAMMATE_ID,
        })
        this.messages = [...this.messages, message]
        return { status: 201, body: message }
      },
      [`POST ${CONVERSATION_PATH}/notes`]: (call) => {
        const note = messageWire({
          direction: 'outbound',
          origin: 'internal_note',
          body: bodyText(call),
          status: 'sent',
          author_user_id: TEAMMATE_ID,
        })
        this.messages = [...this.messages, note]
        return { status: 201, body: note }
      },
    }
  }
}

interface MountOptions {
  path?: string
  role?: MemberRole
  handlers?: Handlers
  capabilities?: unknown
}

/** Mounts the real inbox page under the real session provider; only `fetch` and Clerk are fake. */
export function mountInbox({
  path = '/inbox',
  role = 'owner',
  handlers = {},
  capabilities = CAPABILITIES_WIRE,
}: MountOptions = {}) {
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
    'GET /api/v1/instagram/capabilities': () => ({ body: capabilities }),
    ...handlers,
  })
  renderWithSession(<InboxPage />, {
    path,
    route: '/inbox/:conversationId?',
    requireOrganization: true,
  })
  return api
}

/** Opens the fake inbox's conversation. */
export function mountConversation(inbox: FakeInbox, options: Omit<MountOptions, 'handlers'> = {}) {
  return mountInbox({
    ...options,
    path: `/inbox/${CONVERSATION_ID}`,
    handlers: inbox.handlers(),
  })
}

export function capabilitiesWith(overrides: Record<string, boolean>) {
  return CAPABILITIES_WIRE.map((capability) => ({
    ...capability,
    enabled: overrides[capability.feature] ?? capability.enabled,
  }))
}
