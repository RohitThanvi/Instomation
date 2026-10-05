import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_SIZE } from '@/config/constants'
import { CONVERSATION_ID, conversationWire, uuid } from '@/test/fixtures'
import {
  CONVERSATIONS_PATH,
  FakeInbox,
  errorBody,
  mountConversation,
  mountInbox,
  requestsTo,
  type ConversationWire,
} from '@/test/inbox-harness'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

function person(n: number, name: string | null, overrides: Record<string, unknown> = {}) {
  return conversationWire({
    id: uuid(1000 + n),
    customer: {
      id: uuid(2000 + n),
      external_user_id: `ig-${n}`,
      username: name === null ? null : `${name.toLowerCase()}.ig`,
      display_name: name,
    },
    unread_count: 0,
    ...overrides,
  })
}

/** A list endpoint that applies the same filters the real one does. */
function listing(all: ConversationWire[]) {
  return {
    [`GET ${CONVERSATIONS_PATH}`]: (call: { query: URLSearchParams }) => {
      const { query } = call
      const items = all.filter(
        (item) =>
          (query.get('state') ?? item.state) === item.state &&
          (query.get('priority') ?? item.priority) === item.priority &&
          (query.get('is_lead') !== 'true' || item.is_lead) &&
          (query.get('tag') === null || item.tags.includes(query.get('tag') ?? '')),
      )
      return { body: { items, next_cursor: null } }
    },
  }
}

const listRegion = () => screen.findByRole('region', { name: 'Conversations' })
const listCalls = (calls: Parameters<typeof requestsTo>[0]) =>
  requestsTo(calls, 'GET', CONVERSATIONS_PATH)
const lastListCall = (calls: Parameters<typeof requestsTo>[0]) => listCalls(calls).at(-1)
const namesInOrder = (names: string[]) =>
  within(screen.getByRole('region', { name: 'Conversations' }))
    .getAllByRole('link')
    .map((link) => names.find((name) => link.textContent.includes(name)))

describe('conversation list', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('invites you to pick a conversation when none is open', async () => {
    mountInbox({ handlers: listing([person(1, 'Maya')]) })
    expect(await screen.findByText('Select a conversation')).toBeInTheDocument()
  })

  it('shows who each conversation is with, its status, and what needs attention', async () => {
    mountInbox({
      handlers: listing([
        person(1, 'Maya', { unread_count: 2, is_lead: true, last_intent: 'price_query' }),
        person(2, 'Dev', {
          state: 'human_required',
          priority: 'high',
          summary: 'Wants a refund for a damaged order.',
        }),
        person(3, null, { state: 'resolved' }),
      ]),
    })
    const region = await listRegion()
    await within(region).findByText('Maya')

    const maya = within(region).getByRole('link', { name: /Maya/ })
    expect(within(maya).getByText('Assistant replying')).toBeInTheDocument()
    expect(within(maya).getByText('Lead')).toBeInTheDocument()
    expect(within(maya).getByLabelText('2 unread')).toBeInTheDocument()
    expect(within(maya).getByText('Price question')).toBeInTheDocument()

    const dev = within(region).getByRole('link', { name: /Dev/ })
    expect(within(dev).getByText('Needs a person')).toBeInTheDocument()
    expect(within(dev).getByText('High priority')).toBeInTheDocument()
    expect(within(dev).getByText('Wants a refund for a damaged order.')).toBeInTheDocument()
    expect(within(dev).queryByLabelText(/unread/)).not.toBeInTheDocument()

    const anonymous = within(region).getByRole('link', { name: /Instagram user/ })
    expect(within(anonymous).getByText('Resolved')).toBeInTheDocument()
  })

  it('links each row to its conversation and marks the open one without an unread badge', async () => {
    const inbox = new FakeInbox({ unread_count: 4 })
    mountConversation(inbox)
    const region = await listRegion()
    const row = await within(region).findByRole('link', { name: /Maya Kapoor/ })
    expect(row).toHaveAttribute('href', `/inbox/${CONVERSATION_ID}`)
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(within(row).queryByLabelText(/unread/)).not.toBeInTheDocument()
  })

  describe('filters the server applies', () => {
    it('starts with no filters and the page size the API allows', async () => {
      const { calls } = mountInbox({ handlers: listing([person(1, 'Maya')]) })
      await listRegion()
      await waitFor(() => {
        expect(listCalls(calls)).toHaveLength(1)
      })
      const query = lastListCall(calls)?.query
      expect(query?.get('limit')).toBe(String(PAGE_SIZE))
      for (const param of ['state', 'priority', 'is_lead', 'tag', 'cursor']) {
        expect(query?.has(param)).toBe(false)
      }
    })

    it('filters by status and shows only what the server returns', async () => {
      const { calls } = mountInbox({
        handlers: listing([person(1, 'Maya'), person(2, 'Dev', { state: 'human_required' })]),
      })
      await userEvent.selectOptions(await screen.findByLabelText('Status'), 'human_required')
      await waitFor(() => {
        expect(lastListCall(calls)?.query.get('state')).toBe('human_required')
      })
      const region = await listRegion()
      await waitFor(() => {
        expect(within(region).queryByText('Maya')).not.toBeInTheDocument()
      })
      expect(within(region).getByText('Dev')).toBeInTheDocument()
    })

    it('filters by priority, leads and tag', async () => {
      const { calls } = mountInbox({ handlers: listing([person(1, 'Maya')]) })
      await userEvent.selectOptions(await screen.findByLabelText('Priority filter'), 'high')
      await waitFor(() => {
        expect(lastListCall(calls)?.query.get('priority')).toBe('high')
      })

      await userEvent.click(screen.getByRole('checkbox', { name: 'Leads only' }))
      await waitFor(() => {
        expect(lastListCall(calls)?.query.get('is_lead')).toBe('true')
      })

      await userEvent.type(screen.getByRole('textbox', { name: 'Filter by tag' }), 'vip{Enter}')
      await waitFor(() => {
        expect(lastListCall(calls)?.query.get('tag')).toBe('vip')
      })
      expect(lastListCall(calls)?.query.get('priority')).toBe('high')
    })

    it('clears every filter at once', async () => {
      const { calls } = mountInbox({ handlers: listing([person(1, 'Maya')]) })
      await userEvent.selectOptions(await screen.findByLabelText('Status'), 'resolved')
      await userEvent.click(await screen.findByRole('button', { name: 'Clear filters' }))

      await waitFor(() => {
        expect(lastListCall(calls)?.query.has('state')).toBe(false)
      })
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('Status')).toHaveValue('')
    })
  })

  describe('search and sort happen in the browser', () => {
    it('searches names, handles, tags and summaries without asking the server again', async () => {
      const { calls } = mountInbox({
        handlers: listing([
          person(1, 'Maya', { tags: ['wholesale'] }),
          person(2, 'Dev', { summary: 'Wants a refund.' }),
          person(3, 'Sam'),
        ]),
      })
      const search = await screen.findByRole('searchbox', { name: 'Search loaded conversations' })
      const region = await listRegion()
      await within(region).findByText('Sam')

      for (const [term, expected] of [
        ['maya', 'Maya'],
        ['@dev.ig', 'Dev'],
        ['WHOLESALE', 'Maya'],
        ['refund', 'Dev'],
      ] as const) {
        await userEvent.clear(search)
        await userEvent.type(search, term)
        await waitFor(() => {
          expect(within(region).getAllByRole('link')).toHaveLength(1)
        })
        expect(within(region).getByText(expected)).toBeInTheDocument()
      }
      expect(listCalls(calls)).toHaveLength(1)
    })

    it('sorts by latest activity by default, and unread first on request', async () => {
      mountInbox({
        handlers: listing([
          person(1, 'Alpha', { last_message_at: '2026-10-04T09:00:00Z', unread_count: 5 }),
          person(2, 'Bravo', { last_message_at: '2026-10-04T11:00:00Z', unread_count: 0 }),
          person(3, 'Charlie', { last_message_at: '2026-10-04T10:00:00Z', unread_count: 2 }),
        ]),
      })
      await screen.findByText('Alpha')
      const names = ['Alpha', 'Bravo', 'Charlie']
      expect(namesInOrder(names)).toEqual(['Bravo', 'Charlie', 'Alpha'])

      await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'unread')
      expect(namesInOrder(names)).toEqual(['Alpha', 'Charlie', 'Bravo'])
    })
  })

  describe('when there is nothing to show', () => {
    it('explains an empty inbox to an owner', async () => {
      mountInbox({ handlers: listing([]) })
      expect(await screen.findByText('No conversations yet')).toBeInTheDocument()
      expect(
        screen.getByText(/appear here when someone messages your connected instagram/i),
      ).toBeInTheDocument()
    })

    it('explains an empty inbox to staff, who only see conversations assigned to them', async () => {
      mountInbox({ role: 'staff', handlers: listing([]) })
      expect(
        await screen.findByText('Conversations assigned to you will appear here.'),
      ).toBeInTheDocument()
    })

    it('says when a search matches nothing', async () => {
      mountInbox({ handlers: listing([person(1, 'Maya')]) })
      await userEvent.type(await screen.findByRole('searchbox'), 'zzz')
      expect(await screen.findByText('No conversations match')).toBeInTheDocument()
      expect(screen.getByText('Try changing or clearing your filters.')).toBeInTheDocument()
    })
  })

  describe('paging (the API lists oldest first)', () => {
    const pages = {
      first: { items: [person(1, 'Oldest')], next_cursor: 'p2' },
      second: { items: [person(2, 'Newer')], next_cursor: null },
    }
    const paged = {
      [`GET ${CONVERSATIONS_PATH}`]: (call: { query: URLSearchParams }) => ({
        body: call.query.get('cursor') === 'p2' ? pages.second : pages.first,
      }),
    }

    it('says the list is oldest first and loads newer conversations on request', async () => {
      const { calls } = mountInbox({ handlers: paged })
      const region = await listRegion()
      await within(region).findByText('Oldest')
      expect(within(region).getByText(/showing 1 conversations, oldest first/i)).toBeInTheDocument()
      expect(within(region).queryByText('Newer')).not.toBeInTheDocument()

      await userEvent.click(within(region).getByRole('button', { name: 'Load more' }))
      expect(await within(region).findByText('Newer')).toBeInTheDocument()
      expect(lastListCall(calls)?.query.get('cursor')).toBe('p2')
      expect(within(region).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    })

    it('points a fruitless search at the rest of the list, not at "older" ones', async () => {
      mountInbox({ handlers: paged })
      await userEvent.type(await screen.findByRole('searchbox'), 'zzz')
      expect(await screen.findByText(/load more to search the rest/i)).toBeInTheDocument()
      expect(screen.queryByText(/older ones/i)).not.toBeInTheDocument()
    })
  })

  describe('loading and failure', () => {
    it('shows a loading state, then the list', async () => {
      let release: () => void = () => undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      mountInbox({
        handlers: {
          [`GET ${CONVERSATIONS_PATH}`]: async () => {
            await held
            return { body: { items: [person(1, 'Maya')], next_cursor: null } }
          },
        },
      })
      expect(
        await screen.findByRole('status', { name: 'Loading conversations' }),
      ).toBeInTheDocument()
      release()
      expect(await screen.findByText('Maya')).toBeInTheDocument()
      expect(
        screen.queryByRole('status', { name: 'Loading conversations' }),
      ).not.toBeInTheDocument()
    })

    it('shows the server message with a retry, and recovers', async () => {
      let failing = true
      mountInbox({
        handlers: {
          [`GET ${CONVERSATIONS_PATH}`]: () =>
            failing
              ? { status: 500, body: errorBody('INTERNAL_ERROR', 'The inbox is unavailable.') }
              : { body: { items: [person(1, 'Maya')], next_cursor: null } },
        },
      })
      expect(await screen.findByText('The inbox is unavailable.')).toBeInTheDocument()
      failing = false
      await userEvent.click(screen.getByRole('button', { name: /try again/i }))
      expect(await screen.findByText('Maya')).toBeInTheDocument()
    })
  })
})
