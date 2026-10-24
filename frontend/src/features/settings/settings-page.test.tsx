import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './settings-page'
import { aiSettingsWire, businessProfileWire, organization } from '@/test/fixtures'
import { capabilitiesWith, errorBody } from '@/test/inbox-harness'
import { installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

type Wire = Record<string, unknown>

/** The three endpoints, kept in memory: PUT replaces the profile, PATCH merges, empty PATCH is a 422. */
function mount({
  role = 'owner',
  profile = businessProfileWire(),
  ai = aiSettingsWire(),
  capabilities = capabilitiesWith({}),
  handlers = {},
}: {
  role?: 'owner' | 'admin' | 'manager' | 'staff'
  profile?: Wire
  ai?: Wire
  capabilities?: unknown
  handlers?: Parameters<typeof installMockApi>[0]
} = {}) {
  const state = { profile, ai }
  const api = installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
    'GET /api/v1/instagram/capabilities': () => ({ body: capabilities }),
    'GET /api/v1/business/profile': () => ({ body: state.profile }),
    'PUT /api/v1/business/profile': (call) => {
      state.profile = call.body as Wire
      return { body: state.profile }
    },
    'GET /api/v1/settings/ai': () => ({ body: state.ai }),
    'PATCH /api/v1/settings/ai': (call) => {
      const patch = call.body as Wire
      if (Object.keys(patch).length === 0) {
        return { status: 422, body: errorBody('validation_error', 'provide at least one setting') }
      }
      state.ai = { ...state.ai, ...patch }
      return { body: state.ai }
    },
    ...handlers,
  })
  renderWithSession(<SettingsPage />, {
    path: '/settings',
    route: '/settings',
    requireOrganization: true,
  })
  return { ...api, state }
}

const calls = (all: ReturnType<typeof mount>['calls'], method: string, path: string) =>
  all.filter((call) => call.method === method && call.path === path)
const saveButtons = () => screen.getAllByRole('button', { name: 'Save changes' })
const assistantSave = () => saveButtons()[0] as HTMLElement
const profileSave = () => saveButtons()[1] as HTMLElement
const slider = (name: RegExp) => screen.getByRole('slider', { name })
const toggle = (name: RegExp) => screen.getByRole('switch', { name })

async function ready() {
  await screen.findByRole('switch', { name: /Reply to comments/ })
  await screen.findByRole('textbox', { name: 'Brand name' })
}

describe('settings page: who can see it', () => {
  it.each(['manager', 'staff'] as const)('shows a %s a notice and loads nothing', async (role) => {
    const { calls: all } = mount({ role })
    expect(await screen.findByText('Settings are for owners and admins')).toBeInTheDocument()
    expect(calls(all, 'GET', '/api/v1/settings/ai')).toHaveLength(0)
    expect(calls(all, 'GET', '/api/v1/business/profile')).toHaveLength(0)
  })

  it('shows an admin both sections', async () => {
    mount({ role: 'admin' })
    await ready()
    expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Business profile' })).toBeInTheDocument()
  })
})

describe('assistant settings', () => {
  it('shows what is stored', async () => {
    mount({ ai: aiSettingsWire({ confidence_threshold: 0.85, temperature: 0.2 }) })
    await ready()
    expect(toggle(/Reply to comments/)).toBeChecked()
    expect(toggle(/Reply to direct messages/)).toBeChecked()
    expect(slider(/Minimum confidence/)).toHaveValue('85')
    expect(slider(/Reply style/)).toHaveValue('20')
    // The value reads as a percentage on screen and to a screen reader.
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(slider(/Minimum confidence/)).toHaveAttribute('aria-valuetext', '85%')
    expect(screen.getByLabelText('Longest reply')).toHaveValue(300)
    expect(screen.getByLabelText('Replies per conversation per hour')).toHaveValue(10)
  })

  it('has nothing to save until something changes', async () => {
    mount()
    await ready()
    expect(assistantSave()).toBeDisabled()
    await userEvent.click(toggle(/Reply to direct messages/))
    expect(assistantSave()).toBeEnabled()
    await userEvent.click(toggle(/Reply to direct messages/))
    expect(assistantSave()).toBeDisabled()
  })

  it('sends only what changed and confirms it', async () => {
    const { calls: all } = mount()
    await ready()
    await userEvent.click(toggle(/Reply to direct messages/))
    await userEvent.click(assistantSave())
    expect(await screen.findByText('Assistant settings saved')).toBeInTheDocument()
    expect(calls(all, 'PATCH', '/api/v1/settings/ai').map((call) => call.body)).toEqual([
      { dm_automation_enabled: false },
    ])
    await waitFor(() => {
      expect(assistantSave()).toBeDisabled()
    })
  })

  it('sends the sliders as fractions and the numbers as numbers', async () => {
    const { calls: all } = mount()
    await ready()
    fireEvent.change(slider(/Minimum confidence/), { target: { value: '85' } })
    fireEvent.change(slider(/Reply style/), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Longest reply'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Replies per conversation per hour'), {
      target: { value: '20' },
    })
    await userEvent.click(assistantSave())
    await screen.findByText('Assistant settings saved')
    expect(calls(all, 'PATCH', '/api/v1/settings/ai')[0]?.body).toEqual({
      confidence_threshold: 0.85,
      temperature: 0.1,
      max_response_tokens: 500,
      max_replies_per_conversation_per_hour: 20,
    })
  })

  it('offers private replies only while comment replies are on, and drops them with comments', async () => {
    const { calls: all } = mount({ ai: aiSettingsWire({ private_reply_enabled: true }) })
    await ready()
    expect(toggle(/Continue a comment in private/)).toBeChecked()
    await userEvent.click(toggle(/Reply to comments/))
    expect(screen.queryByRole('switch', { name: /Continue a comment in private/ })).toBeNull()
    await userEvent.click(assistantSave())
    await screen.findByText('Assistant settings saved')
    expect(calls(all, 'PATCH', '/api/v1/settings/ai')[0]?.body).toEqual({
      comment_automation_enabled: false,
      private_reply_enabled: false,
    })
  })

  it('shows only the switches the workspace has enabled, and leaves the others untouched', async () => {
    const { calls: all } = mount({
      capabilities: capabilitiesWith({
        FEATURE_DM_REPLY: false,
        FEATURE_PRIVATE_REPLY: false,
      }),
      ai: aiSettingsWire({ dm_automation_enabled: true, private_reply_enabled: true }),
    })
    await screen.findByRole('switch', { name: /Reply to comments/ })
    expect(screen.queryByRole('switch', { name: /Reply to direct messages/ })).toBeNull()
    expect(screen.queryByRole('switch', { name: /Continue a comment in private/ })).toBeNull()
    fireEvent.change(slider(/Reply style/), { target: { value: '90' } })
    await userEvent.click(assistantSave())
    await screen.findByText('Assistant settings saved')
    expect(calls(all, 'PATCH', '/api/v1/settings/ai')[0]?.body).toEqual({ temperature: 0.9 })
  })

  it('explains when no reply switch is available', async () => {
    mount({
      capabilities: capabilitiesWith({ FEATURE_COMMENT_REPLY: false, FEATURE_DM_REPLY: false }),
    })
    expect(
      await screen.findByText('No reply actions are available for this workspace right now'),
    ).toBeInTheDocument()
  })

  it('does nothing when an unchanged form is submitted with the keyboard', async () => {
    const { calls: all } = mount()
    await ready()
    // The Save button is disabled, but the handler must not rely on that alone.
    fireEvent.submit(screen.getByLabelText('Longest reply').closest('form') as HTMLFormElement)
    // A request would be issued on the next tick, so give one the chance to appear.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls(all, 'PATCH', '/api/v1/settings/ai')).toHaveLength(0)
  })

  it('shows what the server saved, not just what was typed', async () => {
    mount({
      handlers: {
        'PATCH /api/v1/settings/ai': () => ({ body: aiSettingsWire({ temperature: 0.5 }) }),
      },
    })
    await ready()
    fireEvent.change(slider(/Reply style/), { target: { value: '90' } })
    await userEvent.click(assistantSave())
    await screen.findByText('Assistant settings saved')
    await waitFor(() => {
      expect(slider(/Reply style/)).toHaveValue('50')
    })
  })

  it('blocks a reply length outside the allowed range', async () => {
    const { calls: all } = mount()
    await ready()
    fireEvent.change(screen.getByLabelText('Longest reply'), { target: { value: '5' } })
    expect(screen.getByText('Enter a whole number from 50 to 1000')).toBeInTheDocument()
    expect(assistantSave()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Replies per conversation per hour'), {
      target: { value: '0' },
    })
    expect(screen.getByText('Enter a whole number from 1 to 100')).toBeInTheDocument()
    expect(calls(all, 'PATCH', '/api/v1/settings/ai')).toHaveLength(0)
  })

  it('keeps the edits and explains when saving fails', async () => {
    mount({
      handlers: {
        'PATCH /api/v1/settings/ai': () => ({
          status: 500,
          body: errorBody('internal_error', 'The settings service is down'),
        }),
      },
    })
    await ready()
    await userEvent.click(toggle(/Reply to direct messages/))
    await userEvent.click(assistantSave())
    expect(await screen.findByText('We could not save your changes')).toBeInTheDocument()
    expect(screen.getByText('The settings service is down')).toBeInTheDocument()
    expect(toggle(/Reply to direct messages/)).not.toBeChecked()
    expect(assistantSave()).toBeEnabled()
  })

  it('clears the save error as soon as the form is edited again', async () => {
    mount({
      handlers: {
        'PATCH /api/v1/settings/ai': () => ({
          status: 500,
          body: errorBody('internal_error', 'The settings service is down'),
        }),
      },
    })
    await ready()
    await userEvent.click(toggle(/Reply to direct messages/))
    await userEvent.click(assistantSave())
    expect(await screen.findByText('The settings service is down')).toBeInTheDocument()
    await userEvent.click(toggle(/Reply to comments/))
    expect(screen.queryByText('The settings service is down')).toBeNull()
  })

  it('explains a load failure and retries', async () => {
    let failing = true
    mount({
      handlers: {
        'GET /api/v1/settings/ai': () =>
          failing
            ? { status: 500, body: errorBody('internal_error', 'Settings are unavailable') }
            : { body: aiSettingsWire() },
      },
    })
    expect(await screen.findByText('We could not load the assistant settings')).toBeInTheDocument()
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('switch', { name: /Reply to comments/ })).toBeInTheDocument()
  })
})

describe('business profile', () => {
  it('shows what is stored, including an unset field as empty', async () => {
    mount({ profile: businessProfileWire({ location: null }) })
    await ready()
    expect(screen.getByRole('textbox', { name: 'Brand name' })).toHaveValue('Glow Studio')
    expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'How the assistant sounds' })).toHaveValue(
      'friendly',
    )
    expect(screen.getByLabelText('Contact detail 1 name')).toHaveValue('Email')
    expect(screen.getByLabelText('Policy 1 value')).toHaveValue('Free returns within 30 days')
  })

  it('saves the whole profile, since the server replaces it', async () => {
    const { calls: all } = mount()
    await ready()
    expect(profileSave()).toBeDisabled()
    const name = screen.getByRole('textbox', { name: 'Brand name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Glow Studio Jaipur')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'How the assistant sounds' }),
      'professional',
    )
    await userEvent.click(profileSave())
    expect(await screen.findByText('Business profile saved')).toBeInTheDocument()
    expect(calls(all, 'PUT', '/api/v1/business/profile')[0]?.body).toEqual({
      ...businessProfileWire(),
      brand_name: 'Glow Studio Jaipur',
      communication_style: 'professional',
    })
    await waitFor(() => {
      expect(profileSave()).toBeDisabled()
    })
  })

  it('shows the profile the server saved, not just what was typed', async () => {
    mount({
      handlers: {
        'PUT /api/v1/business/profile': (call) => ({
          body: { ...(call.body as Wire), brand_name: 'Glow Studio (verified)' },
        }),
      },
    })
    await ready()
    await userEvent.type(screen.getByRole('textbox', { name: 'Brand name' }), ' 2')
    await userEvent.click(profileSave())
    await screen.findByText('Business profile saved')
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Brand name' })).toHaveValue(
        'Glow Studio (verified)',
      )
    })
  })

  it('clears a field by saving it empty', async () => {
    const { calls: all } = mount()
    await ready()
    await userEvent.clear(screen.getByRole('textbox', { name: 'Location' }))
    await userEvent.click(profileSave())
    await screen.findByText('Business profile saved')
    expect(calls(all, 'PUT', '/api/v1/business/profile')[0]?.body).toMatchObject({
      location: null,
    })
  })

  it('says what is wrong and sends nothing when the form is invalid', async () => {
    const { calls: all } = mount()
    await ready()
    const website = screen.getByRole('textbox', { name: 'Website' })
    await userEvent.clear(website)
    await userEvent.type(website, 'glow.example')
    await userEvent.click(profileSave())
    expect(await screen.findByText('Enter a full link starting with https://')).toBeInTheDocument()
    expect(calls(all, 'PUT', '/api/v1/business/profile')).toHaveLength(0)
  })

  it('adds, edits and removes contact details and policies', async () => {
    const { calls: all } = mount()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Add a contact detail' }))
    await userEvent.type(screen.getByLabelText('Contact detail 2 name'), 'Phone')
    await userEvent.type(screen.getByLabelText('Contact detail 2 value'), '+91 99999 00000')
    await userEvent.click(screen.getByRole('button', { name: 'Remove policy 1' }))
    expect(screen.queryByLabelText('Policy 1 name')).toBeNull()
    await userEvent.click(profileSave())
    await screen.findByText('Business profile saved')
    expect(calls(all, 'PUT', '/api/v1/business/profile')[0]?.body).toMatchObject({
      contact_info: { Email: 'hi@glow.example', Phone: '+91 99999 00000' },
      policies: {},
    })
  })

  it('removes the row that was clicked, not another', async () => {
    const { calls: all } = mount({
      profile: businessProfileWire({
        contact_info: { Email: 'a@x.example', Phone: '123', Address: 'Jaipur' },
      }),
    })
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Remove contact detail 2' }))
    expect(screen.getByLabelText('Contact detail 2 name')).toHaveValue('Address')
    await userEvent.click(profileSave())
    await screen.findByText('Business profile saved')
    expect(calls(all, 'PUT', '/api/v1/business/profile')[0]?.body).toMatchObject({
      contact_info: { Email: 'a@x.example', Address: 'Jaipur' },
    })
  })

  it('refuses a half-filled row and a repeated name', async () => {
    const { calls: all } = mount()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Add a policy' }))
    await userEvent.type(screen.getByLabelText('Policy 2 name'), 'Shipping')
    await userEvent.click(profileSave())
    expect(await screen.findByText('Add a value')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Policy 2 value'), 'Free over ₹999')
    await userEvent.clear(screen.getByLabelText('Policy 2 name'))
    await userEvent.type(screen.getByLabelText('Policy 2 name'), 'Returns')
    await userEvent.click(profileSave())
    expect(await screen.findByText('This name is already used above')).toBeInTheDocument()
    expect(calls(all, 'PUT', '/api/v1/business/profile')).toHaveLength(0)
  })

  it('stops adding rows at the limit', async () => {
    mount({
      profile: businessProfileWire({
        policies: Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [`Policy ${String(index)}`, 'x']),
        ),
      }),
    })
    await ready()
    expect(screen.getByRole('button', { name: 'Add a policy' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add a contact detail' })).toBeEnabled()
  })

  it('keeps the edits and explains when saving fails', async () => {
    mount({
      handlers: {
        'PUT /api/v1/business/profile': () => ({
          status: 500,
          body: errorBody('internal_error', 'The profile service is down'),
        }),
      },
    })
    await ready()
    const name = screen.getByRole('textbox', { name: 'Brand name' })
    await userEvent.type(name, ' 2')
    await userEvent.click(profileSave())
    const notice = await screen.findByText('The profile service is down')
    expect(
      within(notice.closest('[role="alert"]') as HTMLElement).getByText(/could not save/i),
    ).toBeInTheDocument()
    expect(name).toHaveValue('Glow Studio 2')
  })

  it('clears the save error as soon as the profile is edited again', async () => {
    mount({
      handlers: {
        'PUT /api/v1/business/profile': () => ({
          status: 500,
          body: errorBody('internal_error', 'The profile service is down'),
        }),
      },
    })
    await ready()
    const name = screen.getByRole('textbox', { name: 'Brand name' })
    await userEvent.type(name, ' 2')
    await userEvent.click(profileSave())
    expect(await screen.findByText('The profile service is down')).toBeInTheDocument()
    await userEvent.type(name, '3')
    expect(screen.queryByText('The profile service is down')).toBeNull()
  })

  it('loads each section independently', async () => {
    mount({
      handlers: {
        'GET /api/v1/business/profile': () => ({
          status: 500,
          body: errorBody('internal_error', 'Profile unavailable'),
        }),
      },
    })
    expect(await screen.findByText('We could not load your business profile')).toBeInTheDocument()
    expect(await screen.findByRole('switch', { name: /Reply to comments/ })).toBeInTheDocument()
  })
})
