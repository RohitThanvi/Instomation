import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_MESSAGE_LENGTH } from '@/config/constants'
import {
  CONVERSATION_PATH,
  FakeInbox,
  bodyText,
  capabilitiesWith,
  errorBody,
  mountConversation,
  mountInbox,
  requestsTo,
} from '@/test/inbox-harness'
import { CONVERSATION_ID } from '@/test/fixtures'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

const REPLY_LABEL = 'Reply to customer'
const NOTE_LABEL = 'Internal note'
const textbox = (name: string) => screen.findByRole('textbox', { name })
const replyRadio = () => screen.findByRole('radio', { name: REPLY_LABEL })

describe('composer availability', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('only lets people write notes while the assistant is replying, and says why', async () => {
    mountConversation(new FakeInbox({ state: 'ai_active' }))
    expect(await replyRadio()).toBeDisabled()
    expect(
      screen.getByText('The assistant is replying here. Take over to send a message yourself.'),
    ).toBeInTheDocument()
    expect(await textbox(NOTE_LABEL)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send reply' })).not.toBeInTheDocument()
  })

  it('explains that a resolved conversation must be reopened first', async () => {
    mountConversation(new FakeInbox({ state: 'resolved' }))
    expect(await replyRadio()).toBeDisabled()
    expect(
      screen.getByText('This conversation is resolved. Reopen it to send a message.'),
    ).toBeInTheDocument()
  })

  it.each(['human_required', 'human_active'] as const)(
    'allows replying when the state is %s',
    async (state) => {
      mountConversation(new FakeInbox({ state }))
      expect(await replyRadio()).toBeEnabled()
      expect(await textbox(REPLY_LABEL)).toBeInTheDocument()
    },
  )

  it('blocks replies, and says so, when the server has message sending switched off', async () => {
    mountConversation(new FakeInbox({ state: 'human_active' }), {
      capabilities: capabilitiesWith({ FEATURE_DM_REPLY: false }),
    })
    // The composer stays open while capabilities load (the server decides), then closes.
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: REPLY_LABEL })).toBeDisabled()
    })
    expect(
      screen.getByText(/sending messages is turned off for this workspace/i),
    ).toBeInTheDocument()
  })

  it('still allows replying if capabilities cannot be read, leaving the server to decide', async () => {
    const inbox = new FakeInbox({ state: 'human_active' })
    mountInbox({
      path: `/inbox/${CONVERSATION_ID}`,
      handlers: {
        ...inbox.handlers(),
        'GET /api/v1/instagram/capabilities': () => ({
          status: 500,
          body: errorBody('INTERNAL_ERROR', 'Something broke.'),
        }),
      },
    })
    expect(await replyRadio()).toBeEnabled()
  })
})

describe('sending a reply', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the reply to /messages, clears the box and shows it in the thread as sending', async () => {
    const { calls } = mountConversation(new FakeInbox({ state: 'human_active' }))
    await userEvent.type(await textbox(REPLY_LABEL), 'Happy to help!')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))

    const posts = requestsTo(calls, 'POST', `${CONVERSATION_PATH}/messages`)
    await waitFor(() => {
      expect(posts).toHaveLength(1)
    })
    const [post] = posts
    if (post === undefined) throw new Error('the reply was never posted')
    expect(bodyText(post)).toBe('Happy to help!')
    expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/notes`)).toHaveLength(0)

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: REPLY_LABEL })).toHaveValue('')
    })
    const log = await screen.findByRole('log', { name: 'Messages' })
    expect(await within(log).findByText('Happy to help!')).toBeInTheDocument()
    expect(within(log).getByText('Sending')).toBeInTheDocument()
  })

  it('sends with Ctrl+Enter', async () => {
    const { calls } = mountConversation(new FakeInbox({ state: 'human_active' }))
    await userEvent.type(await textbox(REPLY_LABEL), 'On it.')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => {
      expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/messages`)).toHaveLength(1)
    })
  })

  it.each(['', '   '])(
    'refuses to send an empty reply (%j) without calling the server',
    async (text) => {
      const { calls } = mountConversation(new FakeInbox({ state: 'human_active' }))
      const box = await textbox(REPLY_LABEL)
      if (text !== '') await userEvent.type(box, text)
      await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Write a message first.')
      expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/messages`)).toHaveLength(0)
    },
  )

  it('refuses a reply longer than the server accepts', async () => {
    const { calls } = mountConversation(new FakeInbox({ state: 'human_active' }))
    await userEvent.click(await textbox(REPLY_LABEL))
    await userEvent.paste('a'.repeat(MAX_MESSAGE_LENGTH + 1))
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/up to 4,000 characters/i)
    expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/messages`)).toHaveLength(0)
  })

  it('keeps what you wrote, and re-syncs, when the server says the conversation is no longer yours', async () => {
    const inbox = new FakeInbox({ state: 'human_active' })
    mountInbox({
      path: `/inbox/${CONVERSATION_ID}`,
      handlers: {
        ...inbox.handlers(),
        [`POST ${CONVERSATION_PATH}/messages`]: () => {
          // Someone else handed it back to the assistant in the meantime.
          inbox.conversation = { ...inbox.conversation, state: 'ai_active' }
          return {
            status: 409,
            body: errorBody(
              'CONVERSATION_NOT_HUMAN_CONTROLLED',
              'Take over this conversation before sending a manual reply.',
            ),
          }
        },
      },
    })
    await userEvent.type(await textbox(REPLY_LABEL), 'Happy to help!')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))

    expect(
      await screen.findByText(
        'The assistant is replying here. Take over to send a message yourself.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: NOTE_LABEL })).toHaveValue('Happy to help!')
  })
})

describe('internal notes', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts notes to /notes, never /messages, and shows them as team-only', async () => {
    const { calls } = mountConversation(new FakeInbox({ state: 'human_active' }))
    await userEvent.click(await screen.findByRole('radio', { name: NOTE_LABEL }))
    expect(
      screen.getByText(/only your team can see notes\. they are never sent to the customer/i),
    ).toBeInTheDocument()

    await userEvent.type(await textbox(NOTE_LABEL), 'Repeat buyer, offer free shipping.')
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => {
      expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/notes`)).toHaveLength(1)
    })
    expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/messages`)).toHaveLength(0)
    const log = await screen.findByRole('log', { name: 'Messages' })
    expect(await within(log).findByText(/only your team can see this/i)).toBeInTheDocument()
  })

  it('lets notes be added in any state, including while the assistant is replying', async () => {
    const { calls } = mountConversation(new FakeInbox({ state: 'ai_active' }))
    await userEvent.type(await textbox(NOTE_LABEL), 'Check stock first.')
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => {
      expect(requestsTo(calls, 'POST', `${CONVERSATION_PATH}/notes`)).toHaveLength(1)
    })
  })
})
