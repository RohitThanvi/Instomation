import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './dashboard-page'
import type * as AnalyticsModule from '@/api/analytics'
import { fetchDashboardOverview } from '@/api/analytics'
import { ApiError } from '@/api/errors'
import { formatCount } from '@/lib/format'
import { CAPABILITIES_WIRE, DASHBOARD_OVERVIEW, organization } from '@/test/fixtures'
import { emptyPage, installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))
vi.mock('@/api/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof AnalyticsModule>()),
  fetchDashboardOverview: vi.fn(),
}))

function mount(role: 'owner' | 'manager' = 'owner') {
  installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
    'GET /api/v1/instagram/accounts': () => ({ body: emptyPage }),
    'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
  })
  renderWithSession(<DashboardPage />, { path: '/', route: '/', requireOrganization: true })
}

/** The path that lights up the moment the analytics endpoint ships. */
describe('DashboardPage once analytics are available', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['owner', 'manager'] as const)(
    'renders real totals and the chart for a %s',
    async (role) => {
      vi.mocked(fetchDashboardOverview).mockResolvedValue(DASHBOARD_OVERVIEW)
      mount(role)
      expect(await screen.findByText('Leads captured')).toBeInTheDocument()
      expect(screen.getByText('Messages received').nextElementSibling).toHaveTextContent(
        formatCount(1240),
      )
      expect(
        await screen.findByRole('img', { name: /line chart of messages per day/i }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Not yet available')).not.toBeInTheDocument()
      expect(fetchDashboardOverview).toHaveBeenCalledWith(
        expect.anything(),
        '30d',
        expect.any(AbortSignal),
      )
    },
  )

  it('shows a real error with a retry, not the "not available" state, when the request fails', async () => {
    vi.mocked(fetchDashboardOverview).mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', 'Analytics are having a moment.'),
    )
    mount()
    expect(await screen.findByText('Analytics are having a moment.')).toBeInTheDocument()
    expect(screen.queryByText('Not yet available')).not.toBeInTheDocument()

    vi.mocked(fetchDashboardOverview).mockResolvedValue(DASHBOARD_OVERVIEW)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Leads captured')).toBeInTheDocument()
  })
})
