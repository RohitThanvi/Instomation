import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUTOMATION } from './automation'
import { OnboardingPage } from './onboarding-page'
import { CAPABILITIES_WIRE, ORG_ID, accountWire, organization } from '@/test/fixtures'
import { installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'
import { STORAGE_KEYS } from '@/config/constants'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
  UserButton: () => null,
}))

const COMPLETE_DRAFT = {
  profile: {
    brand_name: 'Acme',
    category: 'Skincare',
    description: 'Gentle skincare.',
    website: '',
  },
  products: { items: [] },
  style: { tone: 'professional', notes: '' },
  automation: DEFAULT_AUTOMATION,
}

function mountActivate(draft: unknown) {
  if (draft !== undefined) {
    window.localStorage.setItem(
      `${STORAGE_KEYS.onboardingDraftPrefix}${ORG_ID}`,
      JSON.stringify(draft),
    )
  }
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({ body: { items: [organization()], next_cursor: null } }),
    'GET /api/v1/instagram/accounts': () => ({
      body: { items: [accountWire()], next_cursor: null },
    }),
    'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
  })
  renderWithSession(<OnboardingPage />, {
    path: '/onboarding/activate',
    route: '/onboarding/:step?',
  })
  return api
}

describe('activate step', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows an honest "not yet available" state and sends nothing to the server', async () => {
    const { calls } = mountActivate(COMPLETE_DRAFT)
    await userEvent.click(await screen.findByRole('button', { name: /activate assistant/i }))

    expect(await screen.findByText('Not yet available')).toBeInTheDocument()
    expect(screen.getByText(/nothing was activated/i)).toBeInTheDocument()
    expect(screen.queryByText(/activated!|is now live|success/i)).not.toBeInTheDocument()
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('blocks activation and points back to review while any step is unanswered', async () => {
    mountActivate(undefined)
    expect(await screen.findByText(/setup is not complete/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /activate assistant/i })).toBeDisabled()
  })
})
