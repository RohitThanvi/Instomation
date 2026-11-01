import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AutomationsPage } from './automations-page'
import { organization, ruleWire } from '@/test/fixtures'
import { errorBody } from '@/test/inbox-harness'
import { installMockApi, type RecordedCall } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

type Wire = ReturnType<typeof ruleWire>
type Handlers = Parameters<typeof installMockApi>[0]
type Handler = Handlers[string]
type Role = 'owner' | 'admin' | 'manager' | 'staff'

const BASE = '/api/v1/automations'
const ID = /^\/api\/v1\/automations\/([0-9a-f-]{36})$/

/** An in-memory rules API that behaves like the real one: appends, replaces, deletes, reorders. */
class FakeRules {
  rules: Wire[]
  previewAnswer: Wire | null = null
  overrides: Record<string, Handler> = {}
  private next = 900

  constructor(rules: Wire[] = []) {
    this.rules = rules.map((rule, index) => ({ ...rule, priority: index }))
  }

  private page = () => ({ body: { items: this.rules, next_cursor: null } })

  handlers(role: Role): Handlers {
    const routes: Record<string, Handler> = {
      'GET /api/v1/organizations': () => ({
        body: { items: [organization({ role })], next_cursor: null },
      }),
      [`GET ${BASE}`]: this.page,
      [`POST ${BASE}`]: (call) => {
        this.next += 1
        const created = ruleWire({
          ...(call.body as Wire),
          id: `00000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`,
          priority: this.rules.length,
        })
        this.rules = [...this.rules, created]
        return { status: 201, body: created }
      },
      [`PUT ${BASE}/order`]: (call) => {
        const ids = (call.body as { ids: string[] }).ids
        const known = new Set(this.rules.map((rule) => rule.id))
        if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
          return {
            status: 409,
            body: errorBody('AUTOMATION_RULE_ORDER_STALE', 'The list of rules changed.'),
          }
        }
        this.rules = ids.map((id, priority) => ({
          ...(this.rules.find((rule) => rule.id === id) as Wire),
          priority,
        }))
        return this.page()
      },
      [`POST ${BASE}/preview`]: () => ({ body: { rule: this.previewAnswer } }),
    }
    return new Proxy(
      {},
      {
        get: (_target, key: string) => {
          if (key in this.overrides) return this.overrides[key]
          if (key in routes) return routes[key]
          const [method, path] = key.split(' ')
          const id = ID.exec(path ?? '')?.[1]
          if (id === undefined) return undefined
          if (method === 'PUT') {
            return (call: RecordedCall) => {
              const saved = {
                ...(this.rules.find((rule) => rule.id === id) as Wire),
                ...(call.body as Wire),
                id,
              }
              this.rules = this.rules.map((rule) => (rule.id === id ? saved : rule))
              return { body: saved }
            }
          }
          if (method === 'DELETE') {
            return () => {
              this.rules = this.rules.filter((rule) => rule.id !== id)
              return { status: 204 }
            }
          }
          return undefined
        },
      },
    )
  }
}

function mount(fake: FakeRules, role: Role = 'owner') {
  const api = installMockApi(fake.handlers(role))
  renderWithSession(<AutomationsPage />, {
    path: '/automations',
    route: '/automations',
    requireOrganization: true,
  })
  return api
}

const sent = (calls: readonly RecordedCall[], method: string, pattern: RegExp | string) =>
  calls.filter(
    (call) =>
      call.method === method &&
      (typeof pattern === 'string' ? call.path === pattern : pattern.test(call.path)),
  )
const ready = () => screen.findByRole('list', { name: /order they are tried/i })
const card = (name: string) => screen.getByRole('heading', { name }).closest('li') as HTMLElement
const names = () =>
  within(screen.getByRole('list', { name: /order they are tried/i }))
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent)

async function fill(label: string, value: string) {
  const field = screen.getByLabelText(label)
  await userEvent.clear(field)
  await userEvent.type(field, value)
}

describe('automation rules: who can see it', () => {
  it.each(['owner', 'admin', 'manager'] as const)('shows a %s the rules', async (role) => {
    mount(new FakeRules([ruleWire()]), role)
    expect(await ready()).toBeInTheDocument()
  })

  it('shows staff a notice and asks the server for nothing', async () => {
    const { calls } = mount(new FakeRules([ruleWire()]), 'staff')
    expect(
      await screen.findByText('Automation rules are for owners, admins and managers'),
    ).toBeInTheDocument()
    expect(sent(calls, 'GET', BASE)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /add a rule/i })).toBeNull()
  })
})

describe('the list of rules', () => {
  it('shows each rule in the order it is tried, with what it matches and does', async () => {
    mount(
      new FakeRules([
        ruleWire({
          name: 'Delivery',
          keywords: ['delivery', 'shipping'],
          reply_text: 'We deliver.',
        }),
        ruleWire({
          name: 'Refunds',
          applies_to: 'comment',
          keyword_match: 'all',
          keywords: ['refund', 'order'],
          action: 'handoff',
          reply_text: null,
          handoff_reason: 'refund_dispute',
        }),
        ruleWire({
          name: 'Giveaway',
          enabled: false,
          applies_to: 'both',
          keywords: ['giveaway'],
          action: 'skip',
          reply_text: null,
        }),
      ]),
    )
    await ready()
    expect(names()).toEqual(['Delivery', 'Refunds', 'Giveaway'])
    const delivery = within(card('Delivery'))
    expect(delivery.getByText('#1')).toBeInTheDocument()
    expect(delivery.getByText('Direct messages')).toBeInTheDocument()
    expect(delivery.getByText('Send a reply')).toBeInTheDocument()
    expect(delivery.getByText(/any of these/)).toBeInTheDocument()
    expect(delivery.getByText('“delivery”, “shipping”')).toBeInTheDocument()
    expect(delivery.getByText('We deliver.')).toBeInTheDocument()
    expect(delivery.queryByText('Paused')).toBeNull()

    const refunds = within(card('Refunds'))
    expect(refunds.getByText('#2')).toBeInTheDocument()
    expect(refunds.getByText(/all of these/)).toBeInTheDocument()
    expect(refunds.getByText('Hand over to a person')).toBeInTheDocument()
    expect(refunds.getByText('Refund or dispute')).toBeInTheDocument()

    const giveaway = within(card('Giveaway'))
    expect(giveaway.getByText('Paused')).toBeInTheDocument()
    expect(giveaway.getByText('Send nothing')).toBeInTheDocument()
    expect(giveaway.getByText(/sends nothing, so nobody is replied to/i)).toBeInTheDocument()
  })

  it('shows a rule with a private message and its text', async () => {
    mount(
      new FakeRules([
        ruleWire({
          applies_to: 'comment',
          reply_text: 'Sent details!',
          private_reply_text: 'Free over 500.',
        }),
      ]),
    )
    await ready()
    const view = within(card('Delivery'))
    expect(view.getByText('Sends a fixed reply and a private message')).toBeInTheDocument()
    expect(view.getByText('Free over 500.')).toBeInTheDocument()
  })

  it('says so when there are none and offers to add one', async () => {
    mount(new FakeRules())
    expect(await screen.findByText('No rules yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add a rule/i })).toBeInTheDocument()
  })

  it('explains a load failure and retries', async () => {
    const fake = new FakeRules([ruleWire()])
    let failing = true
    fake.overrides[`GET ${BASE}`] = () =>
      failing
        ? { status: 500, body: errorBody('internal_error', 'Rules are unavailable') }
        : { body: { items: fake.rules, next_cursor: null } }
    mount(fake)
    expect(await screen.findByText('We could not load your rules')).toBeInTheDocument()
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await ready()).toBeInTheDocument()
  })
})

describe('adding a rule', () => {
  it('creates a reply rule with exactly what was entered and adds it last', async () => {
    const fake = new FakeRules([ruleWire({ name: 'Existing' })])
    const { calls } = mount(fake)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    expect(screen.getByRole('form', { name: 'New rule' })).toBeInTheDocument()

    await fill('Name', '  Opening   hours ')
    await fill('Keywords or phrases', 'opening hours\nWhen do you open\n\nopening  hours')
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), 'dm')
    await fill('Reply', '  We open at 9am.  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))

    expect(await screen.findByText('Rule added')).toBeInTheDocument()
    expect(sent(calls, 'POST', BASE)[0]?.body).toEqual({
      name: 'Opening hours',
      enabled: true,
      applies_to: 'dm',
      keywords: ['opening hours', 'When do you open'],
      keyword_match: 'any',
      action: 'reply',
      reply_text: 'We open at 9am.',
      private_reply_text: null,
      handoff_reason: null,
    })
    await waitFor(() => {
      expect(names()).toEqual(['Existing', 'Opening hours'])
    })
    expect(screen.queryByRole('form', { name: 'New rule' })).toBeNull()
    expect(screen.getByRole('button', { name: /add a rule/i })).toBeInTheDocument()
  })

  it('says what is missing and sends nothing', async () => {
    const { calls } = mount(new FakeRules())
    await screen.findByText('No rules yet')
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(screen.getByText('Give the rule a name')).toBeInTheDocument()
    expect(screen.getByText('Add at least one keyword or phrase')).toBeInTheDocument()
    expect(screen.getByText('Write the reply that should be sent')).toBeInTheDocument()
    expect(sent(calls, 'POST', BASE)).toHaveLength(0)
  })

  it('stops a comment reply that is too long before the server has to', async () => {
    const { calls } = mount(new FakeRules())
    await screen.findByText('No rules yet')
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    await fill('Name', 'Long')
    await fill('Keywords or phrases', 'hello')
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'x'.repeat(301) } })
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(screen.getByText(/comment reply can be at most 300 characters/)).toBeInTheDocument()
    expect(sent(calls, 'POST', BASE)).toHaveLength(0)
  })

  it('offers the private message only for a reply rule that can answer comments', async () => {
    mount(new FakeRules())
    await screen.findByText('No rules yet')
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    expect(screen.getByLabelText('Private message (optional)')).toBeInTheDocument() // both
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), 'dm')
    expect(screen.queryByLabelText('Private message (optional)')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), 'comment')
    expect(screen.getByLabelText('Private message (optional)')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Then'), 'skip')
    expect(screen.queryByLabelText('Private message (optional)')).toBeNull()
  })

  it('sends a private message with a comment rule', async () => {
    const { calls } = mount(new FakeRules())
    await screen.findByText('No rules yet')
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    await fill('Name', 'Details')
    await fill('Keywords or phrases', 'details')
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), 'comment')
    await fill('Reply', 'Sent you a message!')
    await fill('Private message (optional)', 'Here are the details.')
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await screen.findByText('Rule added')
    expect(sent(calls, 'POST', BASE)[0]?.body).toMatchObject({
      applies_to: 'comment',
      reply_text: 'Sent you a message!',
      private_reply_text: 'Here are the details.',
    })
  })

  it('creates a hand-over rule with its reason and no text', async () => {
    const { calls } = mount(new FakeRules())
    await screen.findByText('No rules yet')
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    await fill('Name', 'Refunds')
    await fill('Keywords or phrases', 'refund')
    await userEvent.selectOptions(screen.getByLabelText('Then'), 'handoff')
    expect(screen.queryByLabelText('Reply')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(screen.getByText('Choose why this goes to a person')).toBeInTheDocument()
    expect(sent(calls, 'POST', BASE)).toHaveLength(0)
    await userEvent.selectOptions(
      screen.getByLabelText('Why it goes to a person'),
      'refund_dispute',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await screen.findByText('Rule added')
    expect(sent(calls, 'POST', BASE)[0]?.body).toMatchObject({
      action: 'handoff',
      handoff_reason: 'refund_dispute',
      reply_text: null,
      private_reply_text: null,
    })
  })

  it('creates a rule that sends nothing, explaining that', async () => {
    const { calls } = mount(new FakeRules())
    await screen.findByText('No rules yet')
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    await fill('Name', 'Giveaway')
    await fill('Keywords or phrases', 'giveaway')
    await userEvent.selectOptions(screen.getByLabelText('Then'), 'skip')
    expect(screen.getByText('Nothing is sent')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await screen.findByText('Rule added')
    expect(sent(calls, 'POST', BASE)[0]?.body).toMatchObject({
      action: 'skip',
      reply_text: null,
      handoff_reason: null,
    })
  })

  it('keeps the form and shows the server message when saving is refused', async () => {
    const fake = new FakeRules()
    fake.overrides[`POST ${BASE}`] = () => ({
      status: 409,
      body: errorBody('AUTOMATION_RULE_LIMIT', 'You can have at most 50 automation rules.'),
    })
    mount(fake)
    await screen.findByText('No rules yet')
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    await fill('Name', 'One too many')
    await fill('Keywords or phrases', 'hello')
    await fill('Reply', 'Hi')
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(await screen.findByText('We could not save this rule')).toBeInTheDocument()
    expect(screen.getByText('You can have at most 50 automation rules.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('One too many')
  })

  it('discards the form on cancel', async () => {
    const { calls } = mount(new FakeRules())
    await screen.findByText('No rules yet')
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    await fill('Name', 'Never saved')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New rule' })).toBeNull()
    expect(sent(calls, 'POST', BASE)).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: /add a rule/i }))
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })
})

describe('editing a rule', () => {
  it('opens it filled in and saves the whole rule back', async () => {
    const original = ruleWire({
      name: 'Delivery',
      keywords: ['delivery', 'shipping'],
      keyword_match: 'all',
    })
    const { calls } = mount(new FakeRules([original, ruleWire({ name: 'Other' })]))
    await ready()
    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('form', { name: 'Edit rule' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Delivery')
    expect(screen.getByLabelText('Keywords or phrases')).toHaveValue('delivery\nshipping')
    expect(screen.getByLabelText('Match a message that contains')).toHaveValue('all')

    await fill('Reply', 'Free delivery over 500.')
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(await screen.findByText('Rule saved')).toBeInTheDocument()
    expect(sent(calls, 'PUT', new RegExp(`${original.id}$`))[0]?.body).toEqual({
      name: 'Delivery',
      enabled: true,
      applies_to: 'dm',
      keywords: ['delivery', 'shipping'],
      keyword_match: 'all',
      action: 'reply',
      reply_text: 'Free delivery over 500.',
      private_reply_text: null,
      handoff_reason: null,
    })
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Edit rule' })).toBeNull()
    })
    expect(names()).toEqual(['Delivery', 'Other'])
    expect(within(card('Delivery')).getByText('Free delivery over 500.')).toBeInTheDocument()
  })

  it('changes a rule to hand over and drops its reply text', async () => {
    const original = ruleWire({ name: 'Delivery' })
    const { calls } = mount(new FakeRules([original]))
    await ready()
    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Edit' }))
    await userEvent.selectOptions(screen.getByLabelText('Then'), 'handoff')
    await userEvent.selectOptions(screen.getByLabelText('Why it goes to a person'), 'complaint')
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await screen.findByText('Rule saved')
    expect(sent(calls, 'PUT', new RegExp(`${original.id}$`))[0]?.body).toMatchObject({
      action: 'handoff',
      handoff_reason: 'complaint',
      reply_text: null,
    })
  })

  it('keeps a hand-over reason outside the usual list selectable', async () => {
    mount(
      new FakeRules([
        ruleWire({ action: 'handoff', reply_text: null, handoff_reason: 'low_confidence' }),
      ]),
    )
    await ready()
    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Why it goes to a person')).toHaveValue('low_confidence')
  })

  it('can be cancelled without changing anything', async () => {
    const { calls } = mount(new FakeRules([ruleWire()]))
    await ready()
    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Edit' }))
    await fill('Name', 'Changed my mind')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(names()).toEqual(['Delivery'])
    expect(sent(calls, 'PUT', /automations\//)).toHaveLength(0)
  })
})

describe('pausing, deleting and ordering', () => {
  it('pauses a rule and turns it back on, changing only that', async () => {
    const original = ruleWire({ name: 'Delivery' })
    const { calls } = mount(new FakeRules([original]))
    await ready()
    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Pause' }))
    expect(await within(card('Delivery')).findByText('Paused')).toBeInTheDocument()
    const first = sent(calls, 'PUT', new RegExp(`${original.id}$`))[0]?.body
    expect(first).toMatchObject({
      enabled: false,
      name: 'Delivery',
      reply_text: original.reply_text,
    })

    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Turn on' }))
    await waitFor(() => {
      expect(within(card('Delivery')).queryByText('Paused')).toBeNull()
    })
    expect(sent(calls, 'PUT', new RegExp(`${original.id}$`))[1]?.body).toMatchObject({
      enabled: true,
    })
  })

  it('asks before deleting, and keeping it sends nothing', async () => {
    const { calls } = mount(new FakeRules([ruleWire({ name: 'Delivery' })]))
    await ready()
    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/Messages it already sent stay in the inbox/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(sent(calls, 'DELETE', /automations\//)).toHaveLength(0)
    expect(names()).toEqual(['Delivery'])
  })

  it('deletes after the confirmation', async () => {
    const doomed = ruleWire({ name: 'Delivery' })
    const { calls } = mount(new FakeRules([doomed, ruleWire({ name: 'Other' })]))
    await ready()
    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete rule' }))
    expect(await screen.findByText('Rule deleted')).toBeInTheDocument()
    expect(sent(calls, 'DELETE', new RegExp(`${doomed.id}$`))).toHaveLength(1)
    await waitFor(() => {
      expect(names()).toEqual(['Other'])
    })
    expect(within(card('Other')).getByText('#1')).toBeInTheDocument()
  })

  it('moves a rule down and up by sending the whole new order', async () => {
    const [a, b, c] = [ruleWire({ name: 'A' }), ruleWire({ name: 'B' }), ruleWire({ name: 'C' })]
    const { calls } = mount(new FakeRules([a, b, c]))
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Move “A” down' }))
    await waitFor(() => {
      expect(names()).toEqual(['B', 'A', 'C'])
    })
    expect(sent(calls, 'PUT', `${BASE}/order`)[0]?.body).toEqual({ ids: [b.id, a.id, c.id] })
    await userEvent.click(screen.getByRole('button', { name: 'Move “C” up' }))
    await waitFor(() => {
      expect(names()).toEqual(['B', 'C', 'A'])
    })
    expect(sent(calls, 'PUT', `${BASE}/order`)[1]?.body).toEqual({ ids: [b.id, c.id, a.id] })
  })

  it('cannot move the first rule up or the last one down', async () => {
    mount(new FakeRules([ruleWire({ name: 'A' }), ruleWire({ name: 'B' })]))
    await ready()
    expect(screen.getByRole('button', { name: 'Move “A” up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move “B” down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move “A” down' })).toBeEnabled()
  })

  it('shows what is really there when the list changed under it', async () => {
    const [a, b] = [ruleWire({ name: 'A' }), ruleWire({ name: 'B' })]
    const fake = new FakeRules([a, b])
    mount(fake)
    await ready()
    // Someone else adds a rule while this page is open.
    fake.rules = [...fake.rules, ruleWire({ name: 'Added elsewhere', priority: 2 })]
    await userEvent.click(screen.getByRole('button', { name: 'Move “A” down' }))
    expect(await screen.findByText('That did not work')).toBeInTheDocument()
    expect(screen.getByText('The list of rules changed.')).toBeInTheDocument()
    await waitFor(() => {
      expect(names()).toEqual(['A', 'B', 'Added elsewhere'])
    })
  })

  it('shows why a pause or delete failed and leaves the rule as it was', async () => {
    const fake = new FakeRules([ruleWire({ name: 'Delivery' })])
    mount(fake)
    await ready()
    fake.overrides[`PUT ${BASE}/${fake.rules[0]?.id as string}`] = () => ({
      status: 500,
      body: errorBody('internal_error', 'The rules service is down'),
    })
    await userEvent.click(within(card('Delivery')).getByRole('button', { name: 'Pause' }))
    expect(await screen.findByText('The rules service is down')).toBeInTheDocument()
    expect(within(card('Delivery')).queryByText('Paused')).toBeNull()
  })
})

describe('trying a message', () => {
  it('names the rule that would answer it', async () => {
    const fake = new FakeRules([ruleWire({ name: 'Delivery' })])
    fake.previewAnswer = fake.rules[0] as Wire
    const { calls } = mount(fake)
    await ready()
    await userEvent.selectOptions(screen.getByLabelText('It arrives as'), 'comment')
    await userEvent.type(screen.getByLabelText('The message'), '  Do you deliver?  ')
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('“Delivery” would answer this')).toBeInTheDocument()
    // Once in the rule's own card, once in the answer.
    expect(screen.getAllByText(/Sends a fixed reply/)).toHaveLength(2)
    expect(sent(calls, 'POST', `${BASE}/preview`)[0]?.body).toEqual({
      scope: 'comment',
      text: 'Do you deliver?',
    })
  })

  it('says the assistant answers when no rule matches', async () => {
    mount(new FakeRules([ruleWire()]))
    await ready()
    await userEvent.type(screen.getByLabelText('The message'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('No rule matches')).toBeInTheDocument()
    expect(screen.getByText('The assistant would answer this itself.')).toBeInTheDocument()
  })

  it('gives the reason when a hand-over rule would answer', async () => {
    const fake = new FakeRules([
      ruleWire({
        name: 'Refunds',
        action: 'handoff',
        reply_text: null,
        handoff_reason: 'refund_dispute',
      }),
    ])
    fake.previewAnswer = fake.rules[0] as Wire
    mount(fake)
    await ready()
    await userEvent.type(screen.getByLabelText('The message'), 'refund please')
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(
      await screen.findByText(/Hands the conversation to a person: Refund or dispute/),
    ).toBeInTheDocument()
  })

  it('needs a message, clears the answer when it changes, and reports a failure', async () => {
    const fake = new FakeRules([ruleWire()])
    mount(fake)
    await ready()
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('The message'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    await screen.findByText('No rule matches')
    await userEvent.type(screen.getByLabelText('The message'), '!')
    expect(screen.queryByText('No rule matches')).toBeNull()

    fake.overrides[`POST ${BASE}/preview`] = () => ({
      status: 500,
      body: errorBody('internal_error', 'Preview is down'),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('We could not check that')).toBeInTheDocument()
    expect(screen.getByText('Preview is down')).toBeInTheDocument()
  })
})
