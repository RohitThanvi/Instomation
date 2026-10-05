import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationState } from '@/api/conversations'
import { CONVERSATION_ID } from '@/test/fixtures'
import {
  CONVERSATION_PATH,
  CONVERSATIONS_PATH,
  FakeInbox,
  errorBody,
  mountConversation,
  mountInbox,
  requestsTo,
} from '@/test/inbox-harness'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

const button = (name: RegExp) => screen.findByRole('button', { name })
const queryButton = (name: RegExp) => screen.queryByRole('button', { name })

describe('conversation actions', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each<[ConversationState, string[], string[]]>([
    ['ai_active', ['Take over', 'Mark resolved'], ['Hand back to assistant']],
    ['human_required', ['Take over', 'Mark resolved'], ['Hand back to assistant']],
    ['human_active', ['Hand back to assistant', 'Mark resolved'], ['Take over']],
    ['resolved', ['Reopen and take over'], ['Mark resolved', 'Hand back to assistant']],
  ])('offers the right actions when %s', async (state, shown, hidden) => {
    mountConversation(new FakeInbox({ state }))
    for (const label of shown) {
      expect(await button(new RegExp(`^${label}$`))).toBeEnabled()
    }
    for (const label of hidden) {
      expect(queryButton(new RegExp(`^${label}$`))).not.toBeInTheDocument()
    }
  })

  it('takes over, then hands back, with the screen following what the server returns', async () => {
    const inbox = new FakeInbox({ state: 'ai_active' })
    const { calls } = mountConversation(inbox)

    await userEvent.click(await button(/^take over$/i))
    await userEvent.click(await button(/^hand back to assistant$/i))

    expect(await button(/^take over$/i)).toBeInTheDocument()
    expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/takeover`)).toHaveLength(1)
    expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/hand-back`)).toHaveLength(1)
    expect(inbox.conversation.state).toBe('ai_active')
  })

  it('describes the new state in words once a person has taken over', async () => {
    mountConversation(new FakeInbox({ state: 'ai_active' }))
    await userEvent.click(await button(/^take over$/i))
    expect(
      await screen.findByText(/assistant stays quiet until you hand it back/i),
    ).toBeInTheDocument()
  })

  it('resolves a conversation and then offers to reopen it', async () => {
    const { calls } = mountConversation(new FakeInbox({ state: 'human_active' }))
    await userEvent.click(await button(/^mark resolved$/i))

    await userEvent.click(await button(/^reopen and take over$/i))
    expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/resolve`)).toHaveLength(1)
    expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/takeover`)).toHaveLength(1)
  })

  it('disables every action while one is in flight, so they cannot race', async () => {
    const inbox = new FakeInbox({ state: 'human_active' })
    const handlers = inbox.handlers()
    const resolveHandler = handlers[`POST ${CONVERSATION_PATH}/resolve`]
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    mountInbox({
      path: `/inbox/${CONVERSATION_ID}`,
      handlers: {
        ...handlers,
        [`POST ${CONVERSATION_PATH}/resolve`]: async (call) => {
          await held
          return (await resolveHandler?.(call)) ?? { status: 500 }
        },
      },
    })

    await userEvent.click(await button(/^mark resolved$/i))

    // While the request is open: the clicked action says what it is doing, and nothing else is clickable.
    expect(await button(/^resolving…$/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /^hand back to assistant$/i })).toBeDisabled()

    release()
    expect(await button(/^reopen and take over$/i)).toBeEnabled()
  })

  it('shows the server message and keeps the current state when an action fails', async () => {
    const inbox = new FakeInbox({ state: 'ai_active' })
    mountInbox({
      path: `/inbox/${CONVERSATION_ID}`,
      handlers: {
        ...inbox.handlers(),
        [`POST ${CONVERSATION_PATH}/takeover`]: () => ({
          status: 500,
          body: errorBody('INTERNAL_ERROR', 'Something broke.'),
        }),
      },
    })
    await userEvent.click(await button(/^take over$/i))
    await waitFor(() => {
      expect(queryButton(/^take over$/i)).toBeEnabled()
    })
    expect(queryButton(/^hand back to assistant$/i)).not.toBeInTheDocument()
  })
})

describe('opening a conversation', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes the list after loading it, because the server marks it read', async () => {
    const { calls } = mountConversation(new FakeInbox({ unread_count: 3 }))
    await screen.findByRole('heading', { level: 2, name: 'Maya Kapoor' })
    await waitFor(() => {
      expect(requestsTo(calls, 'GET', CONVERSATIONS_PATH).length).toBeGreaterThanOrEqual(2)
    })
  })

  it('explains a conversation that cannot be opened and offers a way back', async () => {
    mountInbox({
      path: `/inbox/${CONVERSATION_ID}`,
      handlers: {
        [`GET ${CONVERSATIONS_PATH}`]: () => ({ body: { items: [], next_cursor: null } }),
        [`GET ${CONVERSATION_PATH}`]: () => ({
          status: 404,
          body: errorBody('CONVERSATION_NOT_FOUND', 'Conversation not found.'),
        }),
      },
    })
    expect(await screen.findByText('Conversation not found.')).toBeInTheDocument()
    expect(screen.getByText('We could not open this conversation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to inbox/i })).toHaveAttribute('href', '/inbox')
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
  })
})
