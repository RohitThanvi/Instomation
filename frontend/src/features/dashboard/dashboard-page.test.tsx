import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './dashboard-page'
import type { Organization } from '@/api/organizations'
import { ANALYTICS_OVERVIEW, CAPABILITIES_WIRE, accountWire, organization } from '@/test/fixtures'
import { emptyPage, installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

const UNSUPPORTED_WORDING = /\blikes?\b|\bbio\b|profile (photo|picture)|avatar/i

function mount({
  accounts = [accountWire()],
  org = organization(),
  accountsResponse,
  analytics = () => ({ body: ANALYTICS_OVERVIEW }),
}: {
  accounts?: unknown[]
  org?: Organization
  accountsResponse?: { status: number; body: unknown }
  analytics?: Parameters<typeof installMockApi>[0][string]
} = {}) {
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({ body: { items: [org], next_cursor: null } }),
    'GET /api/v1/instagram/accounts': () =>
      accountsResponse ?? {
        body: accounts.length === 0 ? emptyPage : { items: accounts, next_cursor: null },
      },
    'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
    'GET /api/v1/analytics/overview': analytics,
  })
  renderWithSession(<DashboardPage />, { path: '/', route: '/', requireOrganization: true })
  return api
}

describe('DashboardPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('analytics', () => {
    const spanDays = (query: URLSearchParams) =>
      (Date.parse(query.get('to') ?? '') - Date.parse(query.get('from') ?? '')) / 86_400_000 + 1

    it.each(['owner', 'manager'] as const)(
      'shows real totals and the chart to a %s, for the last 30 UTC days by default',
      async (role) => {
        const { calls } = mount({ org: organization({ role }) })
        expect(await screen.findByText('New leads')).toBeInTheDocument()
        expect(screen.getByText('Messages received').nextElementSibling).toHaveTextContent('126')
        expect(
          await screen.findByRole('img', { name: /line chart of messages per day/i }),
        ).toBeInTheDocument()
        const request = calls.find((call) => call.path === '/api/v1/analytics/overview')
        expect(request?.query.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(spanDays(request?.query ?? new URLSearchParams())).toBe(30)
      },
    )

    it('switches period with a new request and keeps the old numbers up until it arrives', async () => {
      let release: () => void = () => undefined
      const sevenDays = {
        ...ANALYTICS_OVERVIEW,
        messages: { ...ANALYTICS_OVERVIEW.messages, inbound: 77 },
      }
      const { calls } = mount({
        analytics: async (call) => {
          if (spanDays(call.query) !== 7) return { body: ANALYTICS_OVERVIEW }
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return { body: sevenDays }
        },
      })
      await screen.findByText('New leads')
      await userEvent.selectOptions(screen.getByLabelText('Period'), 'Last 7 days')

      expect(screen.getByText('Messages received').nextElementSibling).toHaveTextContent('126')
      release()
      expect(
        await screen.findByText((_, node) => node?.textContent === '77' && node.tagName === 'DD'),
      ).toBeInTheDocument()
      const analyticsCalls = calls.filter((call) => call.path === '/api/v1/analytics/overview')
      expect(analyticsCalls.map((call) => spanDays(call.query))).toEqual([30, 7])
    })

    it('shows the API’s own message with a retry, never a made-up empty state', async () => {
      let failing = true
      mount({
        analytics: () =>
          failing
            ? {
                status: 500,
                body: {
                  error: { code: 'INTERNAL_ERROR', message: 'Analytics are having a moment.' },
                },
              }
            : { body: ANALYTICS_OVERVIEW },
      })
      expect(await screen.findByText('Analytics are having a moment.')).toBeInTheDocument()
      expect(screen.queryByText('New leads')).not.toBeInTheDocument()

      failing = false
      await userEvent.click(screen.getByRole('button', { name: /try again/i }))
      expect(await screen.findByText('New leads')).toBeInTheDocument()
    })

    it('does not offer analytics, or ask for them, to a role without access', async () => {
      const { calls } = mount({ org: organization({ role: 'staff' }) })
      expect(
        await screen.findByText(/analytics are for owners, admins and managers/i),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Period')).not.toBeInTheDocument()
      expect(calls.some((call) => call.path.includes('analytics'))).toBe(false)
    })

    it('still shows the Instagram connection to every role', async () => {
      mount({ org: organization({ role: 'staff' }) })
      expect(await screen.findByText('@acme.studio')).toBeInTheDocument()
    })
  })

  describe('Instagram connection', () => {
    it('shows a healthy account with no attention banner', async () => {
      mount()
      expect(await screen.findByText('Connected')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('raises a banner linking to settings when a token has expired', async () => {
      mount({ accounts: [accountWire({ status: 'token_expired' })] })
      const banner = await screen.findByRole('alert')
      expect(within(banner).getByText('Reconnect @acme.studio')).toBeInTheDocument()
      expect(within(banner).getByRole('link', { name: /review connection/i })).toHaveAttribute(
        'href',
        '/settings/instagram',
      )
    })

    it('prompts to connect when there is no account, without a banner', async () => {
      mount({ accounts: [] })
      expect(await screen.findByText('No Instagram account is connected yet.')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Connect Instagram' })).toHaveAttribute(
        'href',
        '/settings/instagram',
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps the rest of the page working when the accounts request fails, and can retry', async () => {
      mount({
        accountsResponse: {
          status: 500,
          body: { error: { code: 'INTERNAL_ERROR', message: 'Something broke.' } },
        },
      })
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Something broke.')
      expect(screen.getByText('Reply to comments')).toBeInTheDocument()
      expect(within(alert).getByRole('button', { name: /try again/i })).toBeEnabled()
      await userEvent.click(within(alert).getByRole('button', { name: /try again/i }))
    })
  })

  describe('supported actions', () => {
    it('lists only the actions the server confirms, and never unsupported ones', async () => {
      mount()
      expect(await screen.findByText('Reply to comments')).toBeInTheDocument()
      expect(screen.getByText('Reply to direct messages')).toBeInTheDocument()
      expect(screen.getByText('Continue a comment in private')).toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(UNSUPPORTED_WORDING)
    })
  })

  it('names the workspace', async () => {
    mount()
    expect(await screen.findByText('Acme Studio')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })
})
