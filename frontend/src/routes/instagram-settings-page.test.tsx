import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstagramSettingsPage } from './instagram-settings-page'
import { STORAGE_KEYS } from '@/config/constants'
import { OAUTH_REASON_MESSAGES } from '@/features/instagram/oauth-result'
import { CAPABILITIES_WIRE, accountWire, organization } from '@/test/fixtures'
import { installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

function mount(query: string) {
  installMockApi({
    'GET /api/v1/organizations': () => ({ body: { items: [organization()], next_cursor: null } }),
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
}

describe('Instagram OAuth return page', () => {
  beforeEach(() => {
    window.localStorage.clear()
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
})
