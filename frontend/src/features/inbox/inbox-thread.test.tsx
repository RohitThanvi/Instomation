import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_THREAD_PAGES, MESSAGE_PAGE_SIZE } from '@/config/constants'
import { CONVERSATION_ID, messageWire } from '@/test/fixtures'
import {
  CONVERSATION_PATH,
  FakeInbox,
  errorBody,
  mountConversation,
  mountInbox,
  requestsTo,
} from '@/test/inbox-harness'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

const NOTE_LABEL = 'Internal note · only your team can see this'
const thread = () => screen.findByRole('log', { name: 'Messages' })

const outbound = (overrides: Record<string, unknown>) =>
  messageWire({ direction: 'outbound', ...overrides })

describe('message thread', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows every message in order, with who wrote it', async () => {
    mountConversation(
      new FakeInbox({ state: 'human_active' }, [
        messageWire({ body: 'How much is the starter kit?' }),
        outbound({ origin: 'ai', body: 'The starter kit is $29.', status: 'sent' }),
        outbound({ origin: 'human', body: 'I can add a discount.', status: 'sent' }),
      ]),
    )
    const log = await thread()
    const bodies = within(log)
      .getAllByText(/starter kit|discount/i)
      .map((element) => element.textContent)
    expect(bodies).toEqual([
      'How much is the starter kit?',
      'The starter kit is $29.',
      'I can add a discount.',
    ])
    expect(within(log).getByText('Assistant')).toBeInTheDocument()
    expect(within(log).getByText('Team member')).toBeInTheDocument()
  })

  it('tells the public comment, the public reply and the private reply apart', async () => {
    mountConversation(
      new FakeInbox({ state: 'ai_active' }, [
        messageWire({ channel: 'comment', body: 'Do you ship to Delhi?' }),
        outbound({ origin: 'ai', channel: 'comment', body: 'Yes, we do!', status: 'sent' }),
        outbound({
          origin: 'ai',
          channel: 'private_reply',
          body: 'Delivery to Delhi takes two days.',
          status: 'sent',
        }),
        messageWire({ body: 'Thanks, and the price?' }),
      ]),
    )
    const log = await thread()
    expect(within(log).getByText('Public comment')).toBeInTheDocument()
    expect(within(log).getByText('Public reply')).toBeInTheDocument()
    expect(within(log).getByText('Private reply to a comment')).toBeInTheDocument()
    // A direct message gets no channel caption: only the three above exist.
    expect(within(log).queryAllByText(/^(Public|Private)/)).toHaveLength(3)
  })

  it('makes internal notes unmistakably team-only and never styles them as customer messages', async () => {
    mountConversation(
      new FakeInbox({ state: 'human_active' }, [
        messageWire({ body: 'Where is my order?' }),
        outbound({ origin: 'internal_note', body: 'Customer is a repeat buyer.', status: 'sent' }),
      ]),
    )
    const log = await thread()
    const note = within(log).getByText('Customer is a repeat buyer.')
    expect(note.parentElement).toHaveTextContent(NOTE_LABEL)
    // A note carries no sender or delivery caption, because it is never sent.
    expect(within(log).queryByText('Team member')).not.toBeInTheDocument()
    expect(within(log).queryByText('Sending')).not.toBeInTheDocument()
    expect(within(log).getAllByText(NOTE_LABEL)).toHaveLength(1)
  })

  it('shows the detected topic, and AI confidence only for AI messages with a valid value', async () => {
    mountConversation(
      new FakeInbox({ state: 'ai_active' }, [
        messageWire({ body: 'Price?', intent: 'price_query' }),
        outbound({ origin: 'ai', body: 'It is $29.', status: 'sent', ai_confidence: 0.92 }),
        outbound({ origin: 'ai', body: 'Odd value.', status: 'sent', ai_confidence: 1.7 }),
        outbound({ origin: 'human', body: 'Human reply.', status: 'sent', ai_confidence: 0.5 }),
      ]),
    )
    const log = await thread()
    expect(within(log).getByText('Price question')).toBeInTheDocument()
    expect(within(log).getAllByText(/confident/)).toHaveLength(1)
    expect(within(log).getByText('92% confident')).toBeInTheDocument()
  })

  it('is honest about delivery: pending, failed and held-back messages are labelled', async () => {
    mountConversation(
      new FakeInbox({ state: 'human_active' }, [
        outbound({ origin: 'human', body: 'Sending now.', status: 'pending' }),
        outbound({ origin: 'human', body: 'This one failed.', status: 'failed' }),
        outbound({ origin: 'ai', body: 'This was held.', status: 'suppressed' }),
        outbound({ origin: 'human', body: 'This went fine.', status: 'sent' }),
      ]),
    )
    const log = await thread()
    expect(within(log).getByText('Sending')).toBeInTheDocument()
    expect(within(log).getByText('Not delivered')).toBeInTheDocument()
    expect(within(log).getByText('Not sent')).toBeInTheDocument()
    const alerts = within(log).getAllByRole('alert')
    expect(alerts.map((alert) => alert.textContent).join(' ')).toMatch(
      /did not accept this message/i,
    )
    expect(alerts.map((alert) => alert.textContent).join(' ')).toMatch(
      /turned off for this workspace/i,
    )
    expect(alerts).toHaveLength(2)
  })

  it('shows a calm empty state before anyone has written', async () => {
    mountConversation(new FakeInbox({ state: 'ai_active' }, []))
    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
  })

  it('shows an error with a retry when messages cannot be loaded, leaving the rest usable', async () => {
    const inbox = new FakeInbox({ state: 'ai_active' })
    let failing = true
    mountInbox({
      path: `/inbox/${CONVERSATION_ID}`,
      handlers: {
        ...inbox.handlers(),
        [`GET ${CONVERSATION_PATH}/messages`]: () =>
          failing
            ? { status: 500, body: errorBody('INTERNAL_ERROR', 'Messages are unavailable.') }
            : { body: { items: inbox.messages, next_cursor: null } },
      },
    })
    expect(await screen.findByText('Messages are unavailable.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Maya Kapoor' })).toBeInTheDocument()

    failing = false
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await thread()).toBeInTheDocument()
  })

  it('loads a long conversation page by page, newest last', async () => {
    const pages = [
      { items: [messageWire({ body: 'First message' })], next_cursor: 'c2' },
      { items: [messageWire({ body: 'Last message' })], next_cursor: null },
    ]
    const inbox = new FakeInbox({ state: 'ai_active' })
    const { calls } = mountInbox({
      path: `/inbox/${CONVERSATION_ID}`,
      handlers: {
        ...inbox.handlers(),
        [`GET ${CONVERSATION_PATH}/messages`]: (call) => ({
          body: call.query.get('cursor') === 'c2' ? pages[1] : pages[0],
        }),
      },
    })
    const log = await thread()
    expect(await within(log).findByText('Last message')).toBeInTheDocument()
    expect(within(log).getByText('First message')).toBeInTheDocument()
    expect(within(log).queryByText(/first part of a long conversation/i)).not.toBeInTheDocument()
    expect(requestsTo(calls, 'GET', `${CONVERSATION_PATH}/messages`)[1]?.query.get('cursor')).toBe(
      'c2',
    )
  })

  it('says so when a conversation is longer than the page cap', async () => {
    const inbox = new FakeInbox({ state: 'ai_active' })
    mountInbox({
      path: `/inbox/${CONVERSATION_ID}`,
      handlers: {
        ...inbox.handlers(),
        [`GET ${CONVERSATION_PATH}/messages`]: () => ({
          body: { items: [messageWire()], next_cursor: 'more' },
        }),
      },
    })
    const cap = (MAX_THREAD_PAGES * MESSAGE_PAGE_SIZE).toLocaleString('en-US')
    expect(
      await screen.findByText('Showing the first part of a long conversation'),
    ).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`first ${cap} messages`))).toBeInTheDocument()
  })
})
