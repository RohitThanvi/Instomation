import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstagramSettingsPage } from './instagram-settings-page'
import { STORAGE_KEYS } from '@/config/constants'
import { OAUTH_REASON_MESSAGES } from '@/features/instagram/oauth-result'
import { CAPABILITIES_WIRE, accountWire, organization } from '@/test/fixtures'
import { installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

const navigateToExternal = vi.hoisted(() => vi.fn<(url: string) => void>())
vi.mock('@/lib/navigation', () => ({ navigateToExternal }))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

type Role = 'owner' | 'admin' | 'manager' | 'staff'

function mount(query: string, role: Role = 'owner') {
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
    'POST /api/v1/instagram/oauth/start': () => ({
      body: { authorization_url: 'https://www.instagram.com/oauth/authorize?state=abc' },
    }),
    'GET /api/v1/instagram/accounts': () => ({
      body: { items: [accountWire()], next_cursor: null },
    }),
    'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
  })
  renderWithSession(<InstagramSettingsPage />, {
    path: `/settings/instagram${query}`,
    route: '/settings/instagram',
    requireOrganization: true,
  })
  return api
}

describe('Instagram OAuth return page', () => {
  beforeEach(() => {
    window.localStorage.clear()
    navigateToExternal.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(Object.entries(OAUTH_REASON_MESSAGES))('explains reason %s', async (reason, message) => {
    mount(`?status=error&reason=${reason}`)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText(/could not connect instagram/i)).toBeInTheDocument()
  })

  it('confirms success and lets an onboarding user resume where they left off', async () => {
    window.localStorage.setItem(STORAGE_KEYS.onboardingReturn, '1')
    mount('?status=connected')
    expect(await screen.findByText('Instagram connected')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /continue setup/i })).toHaveAttribute(
      'href',
      '/onboarding/profile',
    )
    expect(window.localStorage.getItem(STORAGE_KEYS.onboardingReturn)).toBeNull()
  })

  it('sends a failed onboarding attempt back to the connect step', async () => {
    window.localStorage.setItem(STORAGE_KEYS.onboardingReturn, '1')
    mount('?status=error&reason=AUTHORIZATION_DENIED')
    expect(await screen.findByRole('link', { name: /back to setup/i })).toHaveAttribute(
      'href',
      '/onboarding/instagram',
    )
  })

  it('shows no banner and no setup link on a plain visit', async () => {
    mount('')
    expect(await screen.findByText('@acme.studio')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /continue setup|back to setup/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/could not connect instagram/i)).not.toBeInTheDocument()
  })

  describe('who can connect', () => {
    it.each(['owner', 'admin'] as const)('lets an %s start the connection', async (role) => {
      const { calls } = mount('', role)
      const button = await screen.findByRole('button', { name: /connect another account/i })
      expect(button).toBeEnabled()
      await userEvent.click(button)
      await vi.waitFor(() => {
        expect(navigateToExternal).toHaveBeenCalledWith(
          'https://www.instagram.com/oauth/authorize?state=abc',
        )
      })
      expect(calls.filter((call) => call.path.endsWith('/oauth/start'))).toHaveLength(1)
    })

    it.each(['manager', 'staff'] as const)(
      'shows a %s the accounts but cannot connect',
      async (role) => {
        const { calls } = mount('', role)
        expect(await screen.findByText('@acme.studio')).toBeInTheDocument()
        const button = screen.getByRole('button', { name: /connect another account/i })
        expect(button).toBeDisabled()
        expect(screen.getByText(/only owners and admins can connect/i)).toBeInTheDocument()
        await userEvent.click(button)
        expect(navigateToExternal).not.toHaveBeenCalled()
        expect(calls.some((call) => call.path.endsWith('/oauth/start'))).toBe(false)
      },
    )
  })
})
