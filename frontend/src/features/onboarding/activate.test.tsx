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

const PROFILE_WIRE = {
  brand_name: null,
  description: null,
  industry: null,
  location: 'Jaipur',
  website: null,
  contact_info: {},
  policies: {},
  communication_style: 'professional',
  custom_instructions: null,
}
const AI_WIRE = {
  dm_automation_enabled: true,
  comment_automation_enabled: true,
  confidence_threshold: 0.7,
  max_response_tokens: 300,
  temperature: 0.3,
  max_replies_per_conversation_per_hour: 5,
}

const WITH_PRODUCT = {
  ...COMPLETE_DRAFT,
  products: {
    items: [{ kind: 'product', name: 'Day cream', description: 'SPF 30', price: '', url: '' }],
  },
}

function mountActivate(
  draft: unknown,
  options: {
    role?: 'owner' | 'admin' | 'manager' | 'staff'
    accounts?: unknown[]
    createEntry?: () => { status?: number; body: unknown }
  } = {},
) {
  if (draft !== undefined) {
    window.localStorage.setItem(
      `${STORAGE_KEYS.onboardingDraftPrefix}${ORG_ID}`,
      JSON.stringify(draft),
    )
  }
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role: options.role ?? 'owner' })], next_cursor: null },
    }),
    'GET /api/v1/instagram/accounts': () => ({
      body: { items: options.accounts ?? [accountWire()], next_cursor: null },
    }),
    'GET /api/v1/instagram/capabilities': () => ({ body: CAPABILITIES_WIRE }),
    'GET /api/v1/business/profile': () => ({ body: PROFILE_WIRE }),
    'PUT /api/v1/business/profile': (call) => ({ body: call.body }),
    'GET /api/v1/knowledge/entries': () => ({ body: { items: [], next_cursor: null } }),
    'POST /api/v1/knowledge/entries':
      options.createEntry ??
      ((call) => ({
        status: 201,
        body: { id: '11111111-1111-4111-8111-111111111111', ...(call.body as object) },
      })),
    'PATCH /api/v1/settings/ai': () => ({ body: AI_WIRE }),
  })
  renderWithSession(<OnboardingPage />, {
    path: '/onboarding/activate',
    route: '/onboarding/:step?',
  })
  return api
}

const activate = async () =>
  userEvent.click(await screen.findByRole('button', { name: /activate assistant/i }))
const writesOf = (calls: { method: string; path: string }[]) =>
  calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.path}`)

describe('activate step', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves everything in order and reports what is now on', async () => {
    const { calls } = mountActivate(WITH_PRODUCT)
    await activate()

    expect(await screen.findByText('Your assistant is set up')).toBeInTheDocument()
    expect(screen.getByText('Replying to direct messages: on')).toBeInTheDocument()
    expect(screen.getByText('Replying to comments: on')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([
      'PUT /api/v1/business/profile',
      'POST /api/v1/knowledge/entries',
      'PATCH /api/v1/settings/ai',
    ])
    const put = calls.find((call) => call.method === 'PUT')
    expect(put?.body).toMatchObject({
      brand_name: 'Acme',
      industry: 'Skincare',
      location: 'Jaipur',
      communication_style: 'professional',
    })
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      dm_automation_enabled: true,
      comment_automation_enabled: true,
    })
    expect(screen.queryByText(/not yet available/i)).not.toBeInTheDocument()
  })

  it('reports the settings the server returned, not the ones that were asked for', async () => {
    mountActivate({
      ...COMPLETE_DRAFT,
      automation: { reply_to_comments: false, reply_to_dms: true },
    })
    await activate()
    // The fake server answers "on" for both whatever was sent; the screen must show that answer.
    expect(await screen.findByText('Replying to comments: on')).toBeInTheDocument()
  })

  it('warns, after saving, when no Instagram account is receiving messages yet', async () => {
    mountActivate(COMPLETE_DRAFT, { accounts: [] })
    await activate()
    expect(await screen.findByText('Your assistant is set up')).toBeInTheDocument()
    expect(screen.getByText(/no instagram account is receiving messages yet/i)).toBeInTheDocument()
  })

  it('does not switch replies on when a product fails to save, and a retry completes it', async () => {
    let failing = true
    const { calls } = mountActivate(WITH_PRODUCT, {
      createEntry: () =>
        failing
          ? {
              status: 500,
              body: { error: { code: 'INTERNAL_ERROR', message: 'The knowledge base is down.' } },
            }
          : {
              status: 201,
              body: {
                id: '22222222-2222-4222-8222-222222222222',
                kind: 'product',
                title: 'Day cream',
                content: 'SPF 30',
              },
            },
    })
    await activate()

    expect(await screen.findByText('The knowledge base is down.')).toBeInTheDocument()
    expect(screen.getByText(/safe to try again/i)).toBeInTheDocument()
    expect(writesOf(calls)).not.toContain('PATCH /api/v1/settings/ai')
    expect(screen.queryByText('Your assistant is set up')).not.toBeInTheDocument()

    failing = false
    await activate()
    expect(await screen.findByText('Your assistant is set up')).toBeInTheDocument()
    expect(writesOf(calls).at(-1)).toBe('PATCH /api/v1/settings/ai')
  })

  it.each(['manager', 'staff'] as const)(
    'does not let a %s activate, because the server would refuse',
    async (role) => {
      const { calls } = mountActivate(COMPLETE_DRAFT, { role })
      expect(
        await screen.findByText(/only owners and admins can activate the assistant/i),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /activate assistant/i })).toBeDisabled()
      expect(writesOf(calls)).toEqual([])
    },
  )

  it('blocks activation and points back to review while any step is unanswered', async () => {
    mountActivate(undefined)
    expect(await screen.findByText(/setup is not complete/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /activate assistant/i })).toBeDisabled()
  })
})
