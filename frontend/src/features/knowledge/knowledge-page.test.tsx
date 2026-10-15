import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgePage } from './knowledge-page'
import { organization } from '@/test/fixtures'
import { installMockApi, type RecordedCall } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

interface Entry {
  id: string
  kind: string
  title: string
  content: string
}

const entry = (index: number, overrides: Partial<Entry> = {}): Entry => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  kind: 'faq',
  title: `Question ${String(index)}`,
  content: `Answer ${String(index)}`,
  ...overrides,
})

/** A small in-memory knowledge API that honours limit, cursor and kind like the real one. */
function mount({
  entries = [entry(1), entry(2, { kind: 'product', title: 'Day cream', content: 'SPF 30' })],
  role = 'owner',
  handlers = {},
}: {
  entries?: Entry[]
  role?: 'owner' | 'admin' | 'manager' | 'staff'
  handlers?: Parameters<typeof installMockApi>[0]
} = {}) {
  const store = [...entries]
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
    'GET /api/v1/knowledge/entries': (call) => {
      const kind = call.query.get('kind')
      const limit = Number(call.query.get('limit'))
      const start = Number(call.query.get('cursor') ?? 0)
      const matching = store.filter((candidate) => kind === null || candidate.kind === kind)
      const items = matching.slice(start, start + limit)
      const more = start + limit < matching.length
      return { body: { items, next_cursor: more ? String(start + limit) : null } }
    },
    'POST /api/v1/knowledge/entries': (call) => {
      const created = { ...entry(store.length + 1), ...(call.body as object) }
      store.push(created)
      return { status: 201, body: created }
    },
    'DELETE /api/v1/knowledge/entries/:id': () => ({ status: 204 }),
    ...handlers,
  })
  // Per-entry routes include the id, so route them through one dispatcher.
  const original = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const match = /^\/api\/v1\/knowledge\/entries\/([^/]+)$/.exec(url.pathname)
    const method = init?.method ?? 'GET'
    if (match?.[1] !== undefined && (method === 'PATCH' || method === 'DELETE')) {
      const index = store.findIndex((candidate) => candidate.id === match[1])
      const call: RecordedCall = {
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      }
      api.calls.push(call)
      if (method === 'DELETE') {
        store.splice(index, 1)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      Object.assign(store[index] ?? {}, call.body)
      return Promise.resolve(new Response(JSON.stringify(store[index]), { status: 200 }))
    }
    return original(input, init)
  })
  renderWithSession(<KnowledgePage />, {
    path: '/knowledge',
    route: '/knowledge',
    requireOrganization: true,
  })
  return { ...api, store }
}

const knowledgeCalls = (calls: RecordedCall[], method?: string) =>
  calls.filter(
    (call) =>
      call.path.startsWith('/api/v1/knowledge') && (method === undefined || call.method === method),
  )

describe('KnowledgePage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('listing', () => {
    it('shows each entry with its type, title and text', async () => {
      mount()
      expect(await screen.findByText('Question 1')).toBeInTheDocument()
      expect(screen.getByText('Answer 1')).toBeInTheDocument()
      expect(screen.getByText('Day cream')).toBeInTheDocument()
      const card = screen.getByText('Day cream').closest('li')
      expect(within(card as HTMLElement).getByText('Product')).toBeInTheDocument()
    })

    it('filters by type on the server', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.selectOptions(screen.getByLabelText('Show'), 'Product')

      expect(await screen.findByText('Day cream')).toBeInTheDocument()
      expect(screen.queryByText('Question 1')).not.toBeInTheDocument()
      expect(knowledgeCalls(calls, 'GET').at(-1)?.query.get('kind')).toBe('product')
    })

    it('loads further pages on request, following the cursor', async () => {
      const many = Array.from({ length: 25 }, (_, index) => entry(index + 1))
      const { calls } = mount({ entries: many })
      expect(await screen.findByText('Question 20')).toBeInTheDocument()
      expect(screen.queryByText('Question 21')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /load more/i }))
      expect(await screen.findByText('Question 25')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
      expect(knowledgeCalls(calls, 'GET').at(-1)?.query.get('cursor')).toBe('20')
    })

    it('invites the first entry when there are none, and names an empty filter', async () => {
      mount({ entries: [] })
      expect(await screen.findByText('Nothing here yet')).toBeInTheDocument()
    })

    it('shows the API’s own message with a retry when loading fails', async () => {
      let failing = true
      mount({
        handlers: {
          'GET /api/v1/knowledge/entries': () =>
            failing
              ? {
                  status: 500,
                  body: { error: { code: 'INTERNAL_ERROR', message: 'Knowledge is resting.' } },
                }
              : { body: { items: [entry(1)], next_cursor: null } },
        },
      })
      expect(await screen.findByText('Knowledge is resting.')).toBeInTheDocument()
      failing = false
      await userEvent.click(screen.getByRole('button', { name: /try again/i }))
      expect(await screen.findByText('Question 1')).toBeInTheDocument()
    })
  })

  describe('adding', () => {
    it('refuses blank fields without calling the server, naming what is missing', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))

      expect(await screen.findByText('Give this entry a title')).toBeInTheDocument()
      expect(screen.getByText('Add the information the assistant should use')).toBeInTheDocument()
      expect(knowledgeCalls(calls, 'POST')).toEqual([])
    })

    it('creates the entry, closes the form and shows it in the list', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
      await userEvent.selectOptions(screen.getByLabelText('Type'), 'Policy')
      await userEvent.type(screen.getByLabelText('Title'), '  Returns  ')
      await userEvent.type(screen.getByLabelText('What the assistant should know'), '30 days.')
      await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))

      expect(await screen.findByText('Returns')).toBeInTheDocument()
      expect(knowledgeCalls(calls, 'POST')[0]?.body).toEqual({
        kind: 'policy',
        title: 'Returns',
        content: '30 days.',
      })
      expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    })

    it('keeps the form and everything typed when the server refuses', async () => {
      const { calls } = mount({
        handlers: {
          'POST /api/v1/knowledge/entries': () => ({
            status: 409,
            body: { error: { code: 'KNOWLEDGE_LIMIT_REACHED', message: 'Limit reached.' } },
          }),
        },
      })
      await screen.findByText('Question 1')
      await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
      await userEvent.type(screen.getByLabelText('Title'), 'Returns')
      await userEvent.type(screen.getByLabelText('What the assistant should know'), '30 days.')
      await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))

      await vi.waitFor(() => {
        expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'Add entry' })).toBeEnabled()
      })
      expect(screen.getByLabelText('Title')).toHaveValue('Returns')
      expect(screen.getByLabelText('What the assistant should know')).toHaveValue('30 days.')
    })
  })

  describe('editing', () => {
    it('sends only the changed field and shows the new text', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.click(screen.getByRole('button', { name: 'Edit Question 1' }))
      const title = screen.getByLabelText('Title')
      await userEvent.clear(title)
      await userEvent.type(title, 'Opening hours')
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(await screen.findByText('Opening hours')).toBeInTheDocument()
      expect(knowledgeCalls(calls, 'PATCH')[0]?.body).toEqual({ title: 'Opening hours' })
    })

    it('sends nothing when saved unchanged', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.click(screen.getByRole('button', { name: 'Edit Question 1' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(await screen.findByRole('button', { name: 'Edit Question 1' })).toBeInTheDocument()
      expect(knowledgeCalls(calls, 'PATCH')).toEqual([])
    })

    it('cancels without saving', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.click(screen.getByRole('button', { name: 'Edit Question 1' }))
      await userEvent.type(screen.getByLabelText('Title'), ' changed')
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(await screen.findByText('Question 1')).toBeInTheDocument()
      expect(knowledgeCalls(calls, 'PATCH')).toEqual([])
    })
  })

  describe('deleting', () => {
    it('asks first, and “keep it” deletes nothing', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.click(screen.getByRole('button', { name: 'Delete Question 1' }))
      const confirm = screen.getByRole('group', { name: 'Confirm deleting Question 1' })
      await userEvent.click(within(confirm).getByRole('button', { name: 'Keep it' }))

      expect(screen.queryByRole('group', { name: /confirm deleting/i })).not.toBeInTheDocument()
      expect(knowledgeCalls(calls, 'DELETE')).toEqual([])
    })

    it('deletes after confirmation and removes the entry', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.click(screen.getByRole('button', { name: 'Delete Question 1' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete entry' }))

      await vi.waitFor(() => {
        expect(screen.queryByText('Question 1')).not.toBeInTheDocument()
      })
      expect(knowledgeCalls(calls, 'DELETE')).toHaveLength(1)
      expect(screen.getByText('Day cream')).toBeInTheDocument()
    })
  })

  describe('testing retrieval', () => {
    const search = (hits: Entry[]) => ({
      'POST /api/v1/knowledge/search': () => ({
        body: hits.map((hit, index) => ({ entry: hit, score: 1 - index / 10 })),
      }),
    })

    it('shows what the assistant would find, best match first', async () => {
      const { calls } = mount({
        handlers: search([entry(2, { title: 'Day cream', content: 'SPF 30' }), entry(1)]),
      })
      await screen.findByText('Question 1')
      await userEvent.type(screen.getByLabelText('What a customer might say'), '  sunscreen  ')
      await userEvent.click(screen.getByRole('button', { name: 'Search' }))

      const results = await screen.findByRole('list', { name: 'Matches, best first' })
      expect(
        within(results)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual([expect.stringContaining('Day cream'), expect.stringContaining('Question 1')])
      expect(calls.find((call) => call.path.endsWith('/search'))?.body).toEqual({
        query: 'sunscreen',
      })
    })

    it('says plainly when nothing matches', async () => {
      mount({ handlers: search([]) })
      await screen.findByText('Question 1')
      await userEvent.type(screen.getByLabelText('What a customer might say'), 'refund')
      await userEvent.click(screen.getByRole('button', { name: 'Search' }))
      expect(await screen.findByText(/nothing matched/i)).toBeInTheDocument()
    })

    it('does not search for blank text', async () => {
      const { calls } = mount()
      await screen.findByText('Question 1')
      await userEvent.type(screen.getByLabelText('What a customer might say'), '   ')
      expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
      expect(calls.some((call) => call.path.endsWith('/search'))).toBe(false)
    })
  })

  describe('access', () => {
    it.each(['owner', 'admin'] as const)('is available to an %s', async (role) => {
      mount({ role })
      expect(await screen.findByText('Question 1')).toBeInTheDocument()
    })

    it.each(['manager', 'staff'] as const)(
      'explains and asks the server for nothing when a %s opens it',
      async (role) => {
        const { calls } = mount({ role })
        expect(
          await screen.findByText(/the knowledge base is for owners and admins/i),
        ).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Add entry' })).not.toBeInTheDocument()
        expect(knowledgeCalls(calls)).toEqual([])
      },
    )
  })
})
