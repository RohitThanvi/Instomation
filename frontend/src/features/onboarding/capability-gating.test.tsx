import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HANDOFF_RULES } from './automation'
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
    expect(document.body.textContent).not.toMatch(UNSUPPORTED_WORDING)
  })

  describe('private reply', () => {
    const PRIVATE = 'Continue a comment in private'

    it('is offered, switched off by default, when the server allows it and comments are answered', async () => {
      mountAutomation(CAPABILITIES_WIRE)
      expect(await screen.findByText(PRIVATE)).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: new RegExp(PRIVATE) })).not.toBeChecked()
      expect(screen.getByText(/one per comment, within 7 days/i)).toBeInTheDocument()
    })

    it('is not offered when the server has not enabled it', async () => {
      mountAutomation(withEnabled({ FEATURE_PRIVATE_REPLY: false }))
      expect(await screen.findByText('Reply to comments')).toBeInTheDocument()
      expect(screen.queryByText(PRIVATE)).not.toBeInTheDocument()
      expect(screen.getAllByRole('switch')).toHaveLength(2)
    })

    it('is not offered when comments are not answered, since it answers a comment', async () => {
      mountAutomation(withEnabled({ FEATURE_COMMENT_REPLY: false }))
      expect(await screen.findByText('Reply to direct messages')).toBeInTheDocument()
      expect(screen.queryByText(PRIVATE)).not.toBeInTheDocument()
    })

    it('goes away when the owner switches comment replies off, and returns with them', async () => {
      mountAutomation(CAPABILITIES_WIRE)
      expect(await screen.findByText(PRIVATE)).toBeInTheDocument()
      const comments = screen.getByRole('switch', { name: /reply to comments/i })
      await userEvent.click(comments)
      expect(screen.queryByText(PRIVATE)).not.toBeInTheDocument()
      await userEvent.click(comments)
      expect(await screen.findByText(PRIVATE)).toBeInTheDocument()
    })
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
    // comments, DMs and the private reply: nothing else, whatever the server claims
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(document.body.textContent).not.toMatch(UNSUPPORTED_WORDING)
  })

  it('hides a reply action the server has switched off', async () => {
    mountAutomation(withEnabled({ FEATURE_COMMENT_REPLY: false }))
    expect(await screen.findByText('Reply to direct messages')).toBeInTheDocument()
    expect(screen.queryByText('Reply to comments')).not.toBeInTheDocument()
    expect(screen.getByText(/some actions are not available/i)).toBeInTheDocument()
  })

  it('explains itself, and offers no controls, when no reply action is enabled', async () => {
    mountAutomation(withEnabled({ FEATURE_COMMENT_REPLY: false, FEATURE_DM_REPLY: false }))
    expect(await screen.findByText(/no reply actions are available/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('states when it hands over as fact, not as switches, because the backend has no such settings', async () => {
    mountAutomation(CAPABILITIES_WIRE)
    expect(await screen.findByText(/cannot be switched off/i)).toBeInTheDocument()
    for (const rule of HANDOFF_RULES) expect(screen.getByText(rule)).toBeInTheDocument()
    expect(
      screen.queryByText(/someone is upset|someone asks for a person/i),
    ).not.toBeInTheDocument()
  })
})
