import { screen, within } from '@testing-library/react'
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

const ACCOUNT_ID = accountWire().id

function mount(
  query: string,
  role: Role = 'owner',
  account: Record<string, unknown> = {},
  extra: Parameters<typeof installMockApi>[0] = {},
) {
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
    'POST /api/v1/instagram/oauth/start': () => ({
      body: { authorization_url: 'https://www.instagram.com/oauth/authorize?state=abc' },
    }),
    'GET /api/v1/instagram/accounts': () => ({
      body: { items: [accountWire(account)], next_cursor: null },
    }),
    'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
    ...extra,
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

  describe('disconnecting', () => {
    it('asks first, then disconnects and shows the refreshed status', async () => {
      let disconnected = false
      const { calls } = mount(
        '',
        'owner',
        {},
        {
          [`DELETE /api/v1/instagram/accounts/${ACCOUNT_ID}`]: () => {
            disconnected = true
            return { status: 204 }
          },
          'GET /api/v1/instagram/accounts': () => ({
            body: {
              items: [accountWire(disconnected ? { status: 'disconnected' } : {})],
              next_cursor: null,
            },
          }),
        },
      )
      await userEvent.click(await screen.findByRole('button', { name: /disconnect @acme.studio/i }))
      expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
      const confirm = screen.getByRole('group', { name: /confirm disconnecting @acme.studio/i })
      expect(confirm).toHaveTextContent(/conversation history is kept/i)
      await userEvent.click(within(confirm).getByRole('button', { name: /disconnect account/i }))
      expect(await screen.findByText('Disconnected')).toBeInTheDocument()
      expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1)
      expect(screen.queryByRole('button', { name: /disconnect @acme.studio/i })).toBeNull()
    })

    it('does nothing when the person stays connected', async () => {
      const { calls } = mount('')
      await userEvent.click(await screen.findByRole('button', { name: /disconnect @acme.studio/i }))
      await userEvent.click(screen.getByRole('button', { name: /stay connected/i }))
      expect(screen.queryByRole('group', { name: /confirm disconnecting/i })).toBeNull()
      expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    })

    it.each(['manager', 'staff'] as const)('is not offered to a %s', async (role) => {
      mount('', role)
      expect(await screen.findByText('@acme.studio')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /disconnect @acme.studio/i })).toBeNull()
    })

    it('is not offered for an account that is already disconnected', async () => {
      mount('', 'owner', { status: 'disconnected' })
      expect(await screen.findByText('Disconnected')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /disconnect @acme.studio/i })).toBeNull()
    })
  })

  describe('re-syncing webhooks', () => {
    const RESYNC = `POST /api/v1/instagram/accounts/${ACCOUNT_ID}/webhooks/resync`

    it('repairs an account that is connected but not receiving messages', async () => {
      let subscribed = false
      const { calls } = mount(
        '',
        'owner',
        {},
        {
          [RESYNC]: () => {
            subscribed = true
            return { body: accountWire({ webhook_subscribed: true }) }
          },
          'GET /api/v1/instagram/accounts': () => ({
            body: {
              items: [accountWire({ webhook_subscribed: subscribed })],
              next_cursor: null,
            },
          }),
        },
      )
      expect(await screen.findByText('Not receiving messages yet')).toBeInTheDocument()
      await userEvent.click(
        screen.getByRole('button', { name: /re-sync webhooks for @acme.studio/i }),
      )
      expect(await screen.findByText('Connected')).toBeInTheDocument()
      expect(screen.getByText(/instagram confirmed the webhook subscription/i)).toBeInTheDocument()
      expect(screen.queryByText(/instagram did not confirm the subscription/i)).toBeNull()
      expect(
        calls.filter((call) => call.method === 'POST' && call.path.endsWith('/resync')),
      ).toHaveLength(1)
    })

    it('says so plainly when Instagram does not confirm the subscription', async () => {
      mount(
        '',
        'owner',
        { webhook_subscribed: false },
        {
          [RESYNC]: () => ({ body: accountWire({ webhook_subscribed: false }) }),
        },
      )
      await userEvent.click(
        await screen.findByRole('button', { name: /re-sync webhooks for @acme.studio/i }),
      )
      expect(
        await screen.findByText(/instagram did not confirm the subscription/i),
      ).toBeInTheDocument()
      expect(screen.getByText('Not receiving messages yet')).toBeInTheDocument()
      expect(screen.queryByText(/instagram confirmed the webhook subscription/i)).toBeNull()
    })

    it('reports a failed request', async () => {
      mount(
        '',
        'owner',
        {},
        {
          [RESYNC]: () => ({
            status: 503,
            body: { error: { code: 'INSTAGRAM_UNAVAILABLE', message: 'Try again shortly.' } },
          }),
        },
      )
      await userEvent.click(
        await screen.findByRole('button', { name: /re-sync webhooks for @acme.studio/i }),
      )
      expect(await screen.findByText(/we could not re-sync the webhooks/i)).toBeInTheDocument()
    })

    it.each(['manager', 'staff'] as const)('is not offered to a %s', async (role) => {
      mount('', role)
      expect(await screen.findByText('@acme.studio')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /re-sync webhooks/i })).toBeNull()
    })

    it.each(['token_expired', 'disconnected'] as const)(
      'is not offered for a %s account',
      async (status) => {
        mount('', 'owner', { status })
        expect(await screen.findByText('@acme.studio')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /re-sync webhooks/i })).toBeNull()
      },
    )
  })
})
