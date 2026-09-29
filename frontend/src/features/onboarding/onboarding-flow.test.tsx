import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingPage } from './onboarding-page'
import type { Organization } from '@/api/organizations'
import { CAPABILITIES_WIRE, accountWire, organization } from '@/test/fixtures'
import { emptyPage, installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
  UserButton: () => null,
}))

const navigateToExternal = vi.hoisted(() => vi.fn<(url: string) => void>())
vi.mock('@/lib/navigation', () => ({ navigateToExternal }))

function mount(step: string) {
  return renderWithSession(<OnboardingPage />, {
    path: `/onboarding/${step}`,
    route: '/onboarding/:step?',
  })
}

describe('onboarding: creating the workspace', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates the workspace with only name and account type, then moves on to Instagram', async () => {
    const orgs: Organization[] = []
    const { calls } = installMockApi({
      'GET /api/v1/organizations': () => ({ body: { items: orgs, next_cursor: null } }),
      'POST /api/v1/organizations': ({ body }) => {
        const input = body as { name: string; account_type: Organization['account_type'] }
        const created = organization({ name: input.name, account_type: input.account_type })
        orgs.push(created)
        return { status: 201, body: created }
      },
      'GET /api/v1/instagram/accounts': () => ({ body: emptyPage }),
      'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
    })

    mount('account-type')
    await userEvent.type(await screen.findByLabelText(/workspace name/i), 'Acme Studio')
    await userEvent.click(screen.getByRole('radio', { name: /creator/i }))
    await userEvent.click(screen.getByRole('button', { name: /create workspace/i }))

    expect(
      await screen.findByRole('heading', { name: /connect your instagram/i }),
    ).toBeInTheDocument()
    const post = calls.find((call) => call.method === 'POST')
    expect(post?.body).toEqual({ name: 'Acme Studio', account_type: 'creator' })
    expect(JSON.stringify(post?.body)).not.toContain('organization')
  })

  it('does not offer to create a second workspace when one already exists', async () => {
    installMockApi({
      'GET /api/v1/organizations': () => ({ body: { items: [organization()], next_cursor: null } }),
    })
    mount('account-type')
    expect(await screen.findByText(/already created/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create workspace/i })).not.toBeInTheDocument()
  })
})

describe('onboarding: connecting Instagram', () => {
  beforeEach(() => {
    window.localStorage.clear()
    navigateToExternal.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts OAuth, remembers to resume setup, and sends the browser to the returned URL', async () => {
    installMockApi({
      'GET /api/v1/organizations': () => ({ body: { items: [organization()], next_cursor: null } }),
      'GET /api/v1/instagram/accounts': () => ({ body: emptyPage }),
      'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
      'POST /api/v1/instagram/oauth/start': () => ({
        body: { authorization_url: 'https://www.instagram.com/oauth/authorize?state=abc' },
      }),
    })
    mount('instagram')
    await userEvent.click(await screen.findByRole('button', { name: /^connect instagram$/i }))
    await waitFor(() => {
      expect(navigateToExternal).toHaveBeenCalledWith(
        'https://www.instagram.com/oauth/authorize?state=abc',
      )
    })
    expect(window.localStorage.getItem('instomation.onboardingReturn')).toBe('1')
  })

  it('does not navigate anywhere if the server returns a non-https authorization URL', async () => {
    installMockApi({
      'GET /api/v1/organizations': () => ({ body: { items: [organization()], next_cursor: null } }),
      'GET /api/v1/instagram/accounts': () => ({ body: emptyPage }),
      'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
      'POST /api/v1/instagram/oauth/start': () => ({
        body: { authorization_url: 'http://evil.test/x' },
      }),
    })
    mount('instagram')
    await userEvent.click(await screen.findByRole('button', { name: /^connect instagram$/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^connect instagram$/i })).toBeEnabled()
    })
    expect(navigateToExternal).not.toHaveBeenCalled()
  })

  it.each(['manager', 'staff'] as const)(
    'disables connecting for the %s role and says why',
    async (role) => {
      installMockApi({
        'GET /api/v1/organizations': () => ({
          body: { items: [organization({ role })], next_cursor: null },
        }),
        'GET /api/v1/instagram/accounts': () => ({ body: emptyPage }),
        'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
      })
      mount('instagram')
      expect(await screen.findByRole('button', { name: /^connect instagram$/i })).toBeDisabled()
      expect(screen.getByText(/only owners and admins/i)).toBeInTheDocument()
    },
  )

  it('never calls the account as live unless it is active and receiving webhooks', async () => {
    installMockApi({
      'GET /api/v1/organizations': () => ({ body: { items: [organization()], next_cursor: null } }),
      'GET /api/v1/instagram/accounts': () => ({
        body: { items: [accountWire({ webhook_subscribed: false })], next_cursor: null },
      }),
      'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
    })
    mount('instagram')
    expect(await screen.findByText('Not receiving messages yet')).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument()
  })
})
