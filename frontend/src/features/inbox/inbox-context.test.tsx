import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberRole } from '@/api/schemas'
import { MAX_TAGS } from '@/config/constants'
import { TEAMMATE_ID } from '@/test/fixtures'
import { CONVERSATION_PATH, FakeInbox, mountConversation, requestsTo } from '@/test/inbox-harness'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

const patches = (calls: Parameters<typeof requestsTo>[0]) =>
  requestsTo(calls, 'PATCH', CONVERSATION_PATH)
const patchBodies = (calls: Parameters<typeof requestsTo>[0]) =>
  patches(calls).map((call) => call.body)
const leadSwitch = () => screen.findByRole('switch', { name: 'Lead' })

describe('customer context', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows what the assistant has worked out about the conversation', async () => {
    mountConversation(
      new FakeInbox({ last_intent: 'price_query', summary: 'Asking about the starter kit price.' }),
    )
    const aside = await screen.findByRole('complementary', { name: 'Customer details' })
    expect(within(aside).getByText('Maya Kapoor')).toBeInTheDocument()
    expect(within(aside).getByText('@maya.k')).toBeInTheDocument()
    expect(within(aside).getByText('Price question')).toBeInTheDocument()
    expect(within(aside).getByText('Asking about the starter kit price.')).toBeInTheDocument()
  })

  it('says plainly when nothing has been detected or summarised yet', async () => {
    mountConversation(new FakeInbox({ last_intent: null, summary: null }))
    const aside = await screen.findByRole('complementary', { name: 'Customer details' })
    expect(within(aside).getByText('Not detected yet')).toBeInTheDocument()
    expect(within(aside).getByText('No summary yet.')).toBeInTheDocument()
  })

  it('does not invent details the API does not provide', async () => {
    mountConversation(new FakeInbox())
    const aside = await screen.findByRole('complementary', { name: 'Customer details' })
    expect(
      within(aside).queryByText(/email|phone|orders?|purchases?|location/i),
    ).not.toBeInTheDocument()
  })

  it.each<[MemberRole, string | null, string]>([
    ['owner', null, 'Unassigned'],
    ['owner', TEAMMATE_ID, 'A team member'],
    ['manager', TEAMMATE_ID, 'A team member'],
    ['staff', TEAMMATE_ID, 'You'],
  ])('shows the assignee for a %s with assignment %s as %s', async (role, assigned, label) => {
    mountConversation(new FakeInbox({ assigned_user_id: assigned }), { role })
    const aside = await screen.findByRole('complementary', { name: 'Customer details' })
    expect(within(aside).getByText('Assigned to').nextElementSibling).toHaveTextContent(label)
  })

  describe('lead', () => {
    it('toggles through the API and then shows the server value', async () => {
      const { calls } = mountConversation(new FakeInbox({ is_lead: false }))
      const toggle = await leadSwitch()
      expect(toggle).toHaveAttribute('aria-checked', 'false')

      await userEvent.click(toggle)
      await waitFor(() => {
        expect(screen.getByRole('switch', { name: 'Lead' })).toHaveAttribute('aria-checked', 'true')
      })
      expect(patchBodies(calls)).toEqual([{ is_lead: true }])
      expect(screen.getByText('Marked as a lead.')).toBeInTheDocument()
    })
  })

  describe('priority', () => {
    it('changes through the API', async () => {
      const { calls } = mountConversation(new FakeInbox({ priority: 'normal' }))
      await userEvent.selectOptions(
        await screen.findByRole('combobox', { name: 'Priority' }),
        'high',
      )
      await waitFor(() => {
        expect(patchBodies(calls)).toEqual([{ priority: 'high' }])
      })
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveValue('high')
      })
    })
  })

  describe('tags', () => {
    it('adds a tag, preserving the existing ones', async () => {
      const { calls } = mountConversation(new FakeInbox({ tags: ['vip'] }))
      await userEvent.type(await screen.findByRole('textbox', { name: 'New tag' }), 'wholesale')
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      await waitFor(() => {
        expect(patchBodies(calls)).toEqual([{ tags: ['vip', 'wholesale'] }])
      })
      expect(await screen.findByText('wholesale')).toBeInTheDocument()
    })

    it('removes a tag', async () => {
      const { calls } = mountConversation(new FakeInbox({ tags: ['vip', 'wholesale'] }))
      await userEvent.click(await screen.findByRole('button', { name: 'Remove tag vip' }))
      await waitFor(() => {
        expect(patchBodies(calls)).toEqual([{ tags: ['wholesale'] }])
      })
    })

    it('rejects a tag that differs only by case, without calling the server', async () => {
      const { calls } = mountConversation(new FakeInbox({ tags: ['vip'] }))
      await userEvent.type(await screen.findByRole('textbox', { name: 'New tag' }), 'VIP')
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(await screen.findByText('That tag is already added.')).toBeInTheDocument()
      expect(patches(calls)).toHaveLength(0)
    })

    it('rejects an empty tag', async () => {
      const { calls } = mountConversation(new FakeInbox())
      await userEvent.click(await screen.findByRole('button', { name: 'Add' }))
      expect(await screen.findByText('Enter a tag.')).toBeInTheDocument()
      expect(patches(calls)).toHaveLength(0)
    })

    it('stops offering to add tags at the limit the server enforces', async () => {
      const tags = Array.from({ length: MAX_TAGS }, (_, index) => `tag-${index}`)
      mountConversation(new FakeInbox({ tags }))
      expect(
        await screen.findByText(`You have reached the limit of ${MAX_TAGS} tags.`),
      ).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'New tag' })).not.toBeInTheDocument()
    })
  })

  it('opens the same details in a panel on narrow screens', async () => {
    mountConversation(new FakeInbox())
    const toggle = await screen.findByRole('button', { name: /details/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('switch', { name: 'Lead' })).toHaveLength(1)

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('switch', { name: 'Lead' })).toHaveLength(2)
  })
})
