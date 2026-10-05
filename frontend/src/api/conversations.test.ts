import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import {
  CONVERSATION_STATES,
  conversationSchema,
  fetchConversations,
  fetchThread,
  INTENTS,
  messageSchema,
  sendReply,
  addNote,
  updateConversation,
  takeOverConversation,
  handBackConversation,
  resolveConversation,
} from './conversations'
import { MAX_THREAD_PAGES, MESSAGE_PAGE_SIZE } from '@/config/constants'
import { CONVERSATION_ID, conversationWire, messageWire } from '@/test/fixtures'

function clientWith(respond: (url: URL, init: RequestInit) => unknown) {
  const fetchImpl = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    return Promise.resolve(new Response(JSON.stringify(respond(url, init ?? {})), { status: 200 }))
  })
  const client = createApiClient({
    baseUrl: 'https://api.test',
    getToken: () => Promise.resolve('tok'),
    getSelectedOrganizationId: () => null,
    fetchImpl,
  })
  return { client, fetchImpl }
}

const callOf = (fetchImpl: ReturnType<typeof clientWith>['fetchImpl'], index = 0) => {
  const [input, init] = fetchImpl.mock.calls[index] ?? []
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input?.url ?? ''),
  )
  return { url, init }
}

describe('conversation schemas (mirror the wire exactly)', () => {
  it('parses a conversation as the backend serializes it', () => {
    expect(conversationSchema.parse(conversationWire()).customer.username).toBe('maya.k')
  })

  it('accepts a customer with no name or handle', () => {
    const wire = conversationWire({
      customer: { ...conversationWire().customer, username: null, display_name: null },
    })
    expect(conversationSchema.safeParse(wire).success).toBe(true)
  })

  it.each(CONVERSATION_STATES)(
    'accepts the lowercase state %s and rejects its uppercase form',
    (state) => {
      expect(conversationSchema.safeParse(conversationWire({ state })).success).toBe(true)
      expect(
        conversationSchema.safeParse(conversationWire({ state: state.toUpperCase() })).success,
      ).toBe(false)
    },
  )

  it('knows every intent the backend can classify', () => {
    expect(INTENTS).toHaveLength(21)
    for (const intent of INTENTS) {
      expect(conversationSchema.safeParse(conversationWire({ last_intent: intent })).success).toBe(
        true,
      )
    }
  })

  it('rejects an unknown priority, a negative unread count and a malformed timestamp', () => {
    expect(conversationSchema.safeParse(conversationWire({ priority: 'urgent' })).success).toBe(
      false,
    )
    expect(conversationSchema.safeParse(conversationWire({ unread_count: -1 })).success).toBe(false)
    expect(
      conversationSchema.safeParse(conversationWire({ created_at: 'yesterday' })).success,
    ).toBe(false)
  })

  it('parses messages of every origin and delivery status', () => {
    for (const origin of ['customer', 'ai', 'human', 'internal_note']) {
      expect(messageSchema.safeParse(messageWire({ origin })).success).toBe(true)
    }
    for (const status of ['received', 'pending', 'sent', 'failed', 'suppressed']) {
      expect(messageSchema.safeParse(messageWire({ status })).success).toBe(true)
    }
    expect(messageSchema.safeParse(messageWire({ status: 'delivered' })).success).toBe(false)
  })
})

describe('conversation requests', () => {
  const page = { items: [conversationWire()], next_cursor: null }

  it('sends only the filters that are set, using the API parameter names', async () => {
    const { client, fetchImpl } = clientWith(() => page)
    await fetchConversations(client, { state: 'human_required', isLead: true, tag: 'vip' }, 'abc')
    const { url } = callOf(fetchImpl)
    expect(url.pathname).toBe('/api/v1/conversations')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '50',
      cursor: 'abc',
      state: 'human_required',
      is_lead: 'true',
      tag: 'vip',
    })
  })

  it('sends no filter parameters when none are set', async () => {
    const { client, fetchImpl } = clientWith(() => page)
    await fetchConversations(client, {}, null)
    expect(Object.fromEntries(callOf(fetchImpl).url.searchParams)).toEqual({ limit: '50' })
  })

  it('patches only the fields it is given', async () => {
    const { client, fetchImpl } = clientWith(() => conversationWire())
    await updateConversation(client, CONVERSATION_ID, { priority: 'high' })
    const { url, init } = callOf(fetchImpl)
    expect(url.pathname).toBe(`/api/v1/conversations/${CONVERSATION_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ priority: 'high' })
  })

  it.each([
    ['takeover', takeOverConversation],
    ['hand-back', handBackConversation],
    ['resolve', resolveConversation],
  ] as const)('POSTs %s without a body', async (segment, action) => {
    const { client, fetchImpl } = clientWith(() => conversationWire())
    await action(client, CONVERSATION_ID)
    const { url, init } = callOf(fetchImpl)
    expect(url.pathname).toBe(`/api/v1/conversations/${CONVERSATION_ID}/${segment}`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  it('sends replies to /messages and internal notes to /notes, never mixed up', async () => {
    const { client, fetchImpl } = clientWith(() => messageWire({ origin: 'human' }))
    await sendReply(client, CONVERSATION_ID, 'Thanks!')
    await addNote(client, CONVERSATION_ID, 'Call back')
    expect(callOf(fetchImpl, 0).url.pathname).toBe(
      `/api/v1/conversations/${CONVERSATION_ID}/messages`,
    )
    expect(callOf(fetchImpl, 1).url.pathname).toBe(`/api/v1/conversations/${CONVERSATION_ID}/notes`)
    expect(JSON.parse(callOf(fetchImpl, 0).init?.body as string)).toEqual({ body: 'Thanks!' })
  })
})

describe('fetchThread', () => {
  it('follows cursors to the newest messages, oldest first', async () => {
    const first = [messageWire({ body: 'one' })]
    const second = [messageWire({ body: 'two' })]
    const { client, fetchImpl } = clientWith((url) =>
      url.searchParams.get('cursor') === 'next'
        ? { items: second, next_cursor: null }
        : { items: first, next_cursor: 'next' },
    )
    const thread = await fetchThread(client, CONVERSATION_ID)
    expect(thread.items.map((message) => message.body)).toEqual(['one', 'two'])
    expect(thread.truncated).toBe(false)
    expect(callOf(fetchImpl).url.searchParams.get('limit')).toBe(String(MESSAGE_PAGE_SIZE))
  })

  it('stops at the page cap and says the thread was cut off', async () => {
    const { client, fetchImpl } = clientWith(() => ({
      items: [messageWire()],
      next_cursor: 'more',
    }))
    const thread = await fetchThread(client, CONVERSATION_ID)
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_THREAD_PAGES)
    expect(thread).toMatchObject({ truncated: true })
    expect(thread.items).toHaveLength(MAX_THREAD_PAGES)
  })
})
