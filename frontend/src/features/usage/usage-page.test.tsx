import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UsagePage } from './usage-page'
import { organization, usageReportWire } from '@/test/fixtures'
import { errorBody } from '@/test/inbox-harness'
import { installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

type Wire = Record<string, unknown>

function mount({
  role = 'owner',
  report = usageReportWire(),
  handlers = {},
}: {
  role?: 'owner' | 'admin' | 'manager' | 'staff'
  report?: Wire
  handlers?: Parameters<typeof installMockApi>[0]
} = {}) {
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
    'GET /api/v1/usage': () => ({ body: report }),
    ...handlers,
  })
  renderWithSession(<UsagePage />, { path: '/usage', route: '/usage', requireOrganization: true })
  return api
}

const usageCalls = (calls: ReturnType<typeof mount>['calls']) =>
  calls.filter((call) => call.method === 'GET' && call.path === '/api/v1/usage')

/** The value shown under a metric label in the summary cards. */
function metric(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' })
  return term.closest('div') as HTMLElement
}

describe('usage page: who can see it', () => {
  it.each(['manager', 'staff'] as const)(
    'shows a %s a notice and asks for nothing',
    async (role) => {
      const { calls } = mount({ role })
      expect(await screen.findByText('Usage is for owners and admins')).toBeInTheDocument()
      expect(usageCalls(calls)).toHaveLength(0)
      expect(screen.queryByLabelText('Period')).toBeNull()
    },
  )

  it.each(['owner', 'admin'] as const)('shows an %s the report', async (role) => {
    mount({ role })
    expect(await screen.findByText('Estimated cost', { selector: 'dt' })).toBeInTheDocument()
  })
})

describe('usage summary', () => {
  it('shows cost, requests, tokens and response time in plain units', async () => {
    mount()
    await screen.findByText('Estimated cost', { selector: 'dt' })
    expect(within(metric('Estimated cost')).getByText('$1.23')).toBeInTheDocument()
    expect(
      within(metric('Estimated cost')).getByText('An estimate, not an invoice'),
    ).toBeInTheDocument()
    expect(within(metric('AI requests')).getByText('1,240')).toBeInTheDocument()
    expect(within(metric('AI requests')).getByText('3 failed')).toBeInTheDocument()
    expect(within(metric('Tokens used')).getByText('911,110')).toBeInTheDocument()
    expect(within(metric('Tokens used')).getByText('812,345 in, 98,765 out')).toBeInTheDocument()
    expect(within(metric('Average response time')).getByText('842 ms')).toBeInTheDocument()
  })

  it('does not mention failures when there were none, and shows a dash for no latency', async () => {
    mount({ report: usageReportWire({ failed_requests: 0, average_latency_ms: null }) })
    await screen.findByText('Estimated cost', { selector: 'dt' })
    expect(screen.queryByText(/failed/)).toBeNull()
    expect(within(metric('Average response time')).getByText('—')).toBeInTheDocument()
  })

  it('shows a tiny cost as a fraction of a cent instead of zero', async () => {
    mount({
      report: usageReportWire({
        totals: { ...usageReportWire().totals, estimated_cost: '0.000432' },
      }),
    })
    await screen.findByText('Estimated cost', { selector: 'dt' })
    expect(within(metric('Estimated cost')).getByText('$0.0004')).toBeInTheDocument()
  })

  it('shows the dates the numbers cover', async () => {
    mount()
    expect(await screen.findByText(/Oct 1 to Oct 3 \(UTC days\)/)).toBeInTheDocument()
  })
})

describe('unpriced requests', () => {
  it('warn that the cost is understated, saying how many requests are missing', async () => {
    mount({ report: usageReportWire({ unpriced_requests: 12 }) })
    expect(
      await screen.findByText('The cost shown is lower than your real spend'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/12 requests used a model that has no price on file/),
    ).toBeInTheDocument()
  })

  it('use the singular for one request', async () => {
    mount({ report: usageReportWire({ unpriced_requests: 1 }) })
    expect(
      await screen.findByText(/1 request used a model that has no price on file/),
    ).toBeInTheDocument()
  })

  it('stay quiet when every request was priced', async () => {
    mount()
    await screen.findByText('Estimated cost', { selector: 'dt' })
    expect(screen.queryByText('The cost shown is lower than your real spend')).toBeNull()
  })
})

describe('usage breakdowns', () => {
  it('lists each purpose in plain words with its numbers, costliest first as sent', async () => {
    mount()
    const table = await screen.findByRole('table', { name: 'By purpose' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('rowheader')[0]?.textContent)).toEqual([
      'Direct message replies',
      'Comment replies',
      'Safety checks',
    ])
    const dm = within(rows[0] as HTMLElement)
    expect(dm.getByText('900')).toBeInTheDocument()
    expect(dm.getByText('600,000 / 80,000')).toBeInTheDocument()
    expect(dm.getByText('$1.00')).toBeInTheDocument()
  })

  it('lists each model with its provider', async () => {
    mount()
    const table = await screen.findByRole('table', { name: 'By model' })
    expect(within(table).getByText('llama-3.3-70b-versatile')).toBeInTheDocument()
    expect(within(table).getByText('groq')).toBeInTheDocument()
    expect(within(table).getByText('gpt-4o-mini')).toBeInTheDocument()
    expect(within(table).getByText('openai')).toBeInTheDocument()
    // Below a dollar the cost keeps four decimals, so a fraction of a cent is visible.
    expect(within(table).getByText('$0.1345')).toBeInTheDocument()
  })

  it('shows a purpose it does not know rather than dropping it', async () => {
    mount({
      report: usageReportWire({
        by_purpose: [
          {
            purpose: 'brand_voice_check',
            requests: 5,
            input_tokens: 10,
            output_tokens: 5,
            estimated_cost: '0.01',
          },
        ],
      }),
    })
    const table = await screen.findByRole('table', { name: 'By purpose' })
    expect(within(table).getByText('Brand voice check')).toBeInTheDocument()
  })

  it('draws the daily chart with an accessible table of requests and cost per day', async () => {
    mount()
    expect(
      await screen.findByRole('img', { name: /Bar chart of AI requests per day/ }),
    ).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'AI requests and estimated cost per day' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => Array.from(row.children).map((cell) => cell.textContent))).toEqual([
      ['Oct 1', '400', '$0.40'],
      ['Oct 2', '0', '$0.00'],
      ['Oct 3', '840', '$0.8345'],
    ])
  })
})

describe('usage page states', () => {
  it('says so when there was no usage, without empty tables', async () => {
    mount({
      report: usageReportWire({
        totals: { requests: 0, input_tokens: 0, output_tokens: 0, estimated_cost: '0' },
        failed_requests: 0,
        average_latency_ms: null,
        by_purpose: [],
        by_model: [],
        daily: [{ date: '2026-10-01', requests: 0, estimated_cost: '0' }],
      }),
    })
    expect(await screen.findByText('No AI usage in this period')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('Estimated cost', { selector: 'dt' })).toBeNull()
  })

  it('asks for the period that was chosen', async () => {
    const { calls } = mount()
    await screen.findByText('Estimated cost', { selector: 'dt' })
    const first = usageCalls(calls)[0]?.query
    const span = (query: URLSearchParams | undefined) =>
      (Date.parse(query?.get('to') ?? '') - Date.parse(query?.get('from') ?? '')) / 86_400_000 + 1
    expect(span(first)).toBe(30)

    await userEvent.selectOptions(screen.getByLabelText('Period'), '7d')
    await vi.waitFor(() => {
      expect(usageCalls(calls)).toHaveLength(2)
    })
    expect(span(usageCalls(calls)[1]?.query)).toBe(7)
  })

  it('explains a failure and retries', async () => {
    let failing = true
    mount({
      handlers: {
        'GET /api/v1/usage': () =>
          failing
            ? { status: 500, body: errorBody('internal_error', 'Usage is unavailable') }
            : { body: usageReportWire() },
      },
    })
    expect(await screen.findByText('We could not load your usage')).toBeInTheDocument()
    expect(screen.getByText('Usage is unavailable')).toBeInTheDocument()
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Estimated cost', { selector: 'dt' })).toBeInTheDocument()
  })

  it('refuses a report with a malformed cost instead of showing a wrong total', async () => {
    mount({
      report: usageReportWire({ totals: { ...usageReportWire().totals, estimated_cost: '1e-7' } }),
    })
    expect(await screen.findByText('We could not load your usage')).toBeInTheDocument()
    expect(screen.queryByText('Estimated cost', { selector: 'dt' })).toBeNull()
  })
})
