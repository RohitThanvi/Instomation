import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandoffsPage } from './handoffs-page'
import { CONVERSATION_ID, handoffWire, organization } from '@/test/fixtures'
import { errorBody } from '@/test/inbox-harness'
import { installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

type Wire = ReturnType<typeof handoffWire>

/** An in-memory handoff API that honours status, cursor and limit like the real one. */
function mount({
  unresolved = [handoffWire()],
  resolved = [],
  counts = { open: 3, assigned: 1 },
  role = 'owner',
  handlers = {},
}: {
  unresolved?: Wire[]
  resolved?: Wire[]
  counts?: { open: number; assigned: number }
  role?: 'owner' | 'admin' | 'manager' | 'staff'
  handlers?: Parameters<typeof installMockApi>[0]
} = {}) {
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
    'GET /api/v1/handoffs': (call) => {
      const source = call.query.get('status') === 'resolved' ? resolved : unresolved
      const limit = Number(call.query.get('limit'))
      const start = Number(call.query.get('cursor') ?? 0)
      const items = source.slice(start, start + limit)
      return {
        body: { items, next_cursor: start + limit < source.length ? String(start + limit) : null },
      }
    },
    'GET /api/v1/handoffs/counts': () => ({ body: counts }),
    ...handlers,
  })
  renderWithSession(<HandoffsPage />, {
    path: '/handoffs',
    route: '/handoffs',
    requireOrganization: true,
  })
  return api
}

const listCalls = (calls: ReturnType<typeof mount>['calls']) =>
  calls.filter((call) => call.method === 'GET' && call.path === '/api/v1/handoffs')

describe('handoffs page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists the waiting queue with why, who and where to go', async () => {
    mount({
      unresolved: [
        handoffWire({ reason: 'refund_dispute', conversation_priority: 'high' }),
        handoffWire({
          reason: 'low_confidence',
          status: 'assigned',
          conversation_id: '00000000-0000-4000-8000-000000000999',
        }),
      ],
    })
    const rows = await screen.findAllByRole('link')
    expect(rows).toHaveLength(2)
    const first = within(rows[0] as HTMLElement)
    expect(first.getByText('Maya Kapoor')).toBeInTheDocument()
    expect(first.getByText('@maya.k')).toBeInTheDocument()
    expect(first.getByText('Refund or dispute')).toBeInTheDocument()
    expect(first.getByText('Waiting for a person')).toBeInTheDocument()
    expect(first.getByText('High priority')).toBeInTheDocument()
    // A waiting handoff is timed from when it opened.
    expect(first.getByText(/^Waiting /, { selector: 'time' })).toHaveAttribute(
      'datetime',
      '2026-10-04T09:30:00.123456Z',
    )
    expect(rows[0]).toHaveAttribute('href', `/inbox/${CONVERSATION_ID}`)

    const second = within(rows[1] as HTMLElement)
    expect(second.getByText('Assistant was unsure')).toBeInTheDocument()
    expect(second.getByText('Being handled')).toBeInTheDocument()
    expect(second.queryByText('High priority')).not.toBeInTheDocument()
    expect(rows[1]).toHaveAttribute('href', '/inbox/00000000-0000-4000-8000-000000000999')
  })

  it('summarises how many are waiting and being handled', async () => {
    mount({ counts: { open: 12, assigned: 2 } })
    expect(await screen.findByText(/12 waiting for a person · 2 being handled/)).toBeInTheDocument()
  })

  it('still shows the queue when the counts cannot be loaded', async () => {
    mount({
      handlers: {
        'GET /api/v1/handoffs/counts': () => ({
          status: 500,
          body: errorBody('internal_error', 'Counts are down'),
        }),
      },
    })
    expect(await screen.findByText('Maya Kapoor')).toBeInTheDocument()
    expect(screen.queryByText(/waiting for a person ·/)).not.toBeInTheDocument()
  })

  it('shows resolved handoffs from the server on request, and only then', async () => {
    const { calls } = mount({
      resolved: [handoffWire({ status: 'resolved', resolved_at: '2026-10-05T09:30:00Z' })],
    })
    await screen.findByText('Waiting for a person')
    expect(listCalls(calls)[0]?.query.has('status')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Resolved' }))
    // A resolved handoff is timed from when it was resolved, not when it opened.
    expect(await screen.findByText(/^Resolved /, { selector: 'time' })).toHaveAttribute(
      'datetime',
      '2026-10-05T09:30:00Z',
    )
    expect(listCalls(calls).some((call) => call.query.get('status') === 'resolved')).toBe(true)
    expect(screen.getByRole('button', { name: 'Resolved' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Waiting for a person')).not.toBeInTheDocument()
  })

  it('loads the next page from the cursor and appends it', async () => {
    const many = Array.from({ length: 55 }, (_, index) =>
      handoffWire({
        customer: { ...handoffWire().customer, display_name: `Customer ${String(index)}` },
      }),
    )
    const { calls } = mount({ unresolved: many })
    await screen.findByText('Customer 0')
    expect(screen.getAllByRole('link')).toHaveLength(50)

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Customer 54')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(55)
    expect(listCalls(calls).at(-1)?.query.get('cursor')).toBe('50')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('says so when nothing is waiting, and when nothing is resolved', async () => {
    mount({ unresolved: [], counts: { open: 0, assigned: 0 } })
    expect(await screen.findByText('Nothing is waiting for you')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resolved' }))
    expect(await screen.findByText('No resolved handoffs yet')).toBeInTheDocument()
  })

  it('explains a failure and retries', async () => {
    let failing = true
    mount({
      handlers: {
        'GET /api/v1/handoffs': () =>
          failing
            ? { status: 500, body: errorBody('internal_error', 'The queue is unavailable') }
            : { body: { items: [handoffWire()], next_cursor: null } },
      },
    })
    expect(await screen.findByText('We could not load your handoffs')).toBeInTheDocument()
    expect(screen.getByText('The queue is unavailable')).toBeInTheDocument()

    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Maya Kapoor')).toBeInTheDocument()
  })

  it('tells staff they only see their own conversations, and nobody else', async () => {
    mount({ role: 'staff' })
    expect(await screen.findByText(/conversations assigned to you/i)).toBeInTheDocument()
  })

  it('does not tell owners that', async () => {
    mount({ role: 'owner' })
    await screen.findByText('Maya Kapoor')
    await waitFor(() => {
      expect(screen.queryByText(/conversations assigned to you/i)).not.toBeInTheDocument()
    })
  })
})
