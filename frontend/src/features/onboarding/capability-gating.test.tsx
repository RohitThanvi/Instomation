import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingPage } from './onboarding-page'
import { CAPABILITIES_WIRE, organization } from '@/test/fixtures'
import { emptyPage, installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
  UserButton: () => null,
}))

const UNSUPPORTED_WORDING = /\blikes?\b|\bbio\b|profile (photo|picture)|avatar/i

function mountAutomation(capabilities: unknown) {
  installMockApi({
    'GET /api/v1/organizations': () => ({ body: { items: [organization()], next_cursor: null } }),
    'GET /api/v1/instagram/accounts': () => ({ body: emptyPage }),
    'GET /api/v1/instagram/capabilities': () => ({ body: capabilities }),
  })
  return renderWithSession(<OnboardingPage />, {
    path: '/onboarding/automation',
    route: '/onboarding/:step?',
  })
}

function withEnabled(overrides: Record<string, boolean>) {
  return CAPABILITIES_WIRE.map((capability) => ({
    ...capability,
    enabled: overrides[capability.feature] ?? capability.enabled,
  }))
}

describe('automation step: capability gating', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a control for each enabled reply action and nothing about unsupported ones', async () => {
    mountAutomation(CAPABILITIES_WIRE)
    expect(await screen.findByText('Reply to comments')).toBeInTheDocument()
    expect(screen.getByText('Reply to direct messages')).toBeInTheDocument()
    expect(screen.getByText('Continue a comment in private')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(UNSUPPORTED_WORDING)
  })

  it('still never renders comment-like or profile controls even if a server claims they are enabled', async () => {
    mountAutomation(
      withEnabled({
        FEATURE_COMMENT_LIKE: true,
        FEATURE_PROFILE_BIO_UPDATE: true,
        FEATURE_PROFILE_PHOTO_UPDATE: true,
      }),
    )
    expect(await screen.findByText('Reply to comments')).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(3 + 3) // 3 reply actions + 3 handoff rules
    expect(document.body.textContent).not.toMatch(UNSUPPORTED_WORDING)
  })

  it('hides a reply action the server has switched off', async () => {
    mountAutomation(withEnabled({ FEATURE_PRIVATE_REPLY: false }))
    expect(await screen.findByText('Reply to comments')).toBeInTheDocument()
    expect(screen.queryByText('Continue a comment in private')).not.toBeInTheDocument()
    expect(screen.getByText(/some actions are not available/i)).toBeInTheDocument()
  })

  it('explains itself, and offers only handoff rules, when no reply action is enabled', async () => {
    mountAutomation(
      withEnabled({
        FEATURE_COMMENT_REPLY: false,
        FEATURE_DM_REPLY: false,
        FEATURE_PRIVATE_REPLY: false,
      }),
    )
    expect(await screen.findByText(/no reply actions are available/i)).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(3)
  })
})
