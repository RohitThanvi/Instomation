import { describe, expect, it, vi } from 'vitest'
import {
  createRule,
  deleteRule,
  fetchRules,
  previewRule,
  reorderRules,
  replaceRule,
  RULE_ACTIONS,
  RULE_SCOPES,
  ruleSchema,
  type RuleInput,
} from './automations'
import { createApiClient } from './client'
import { HANDOFF_REASONS } from './handoffs'
import { ruleWire } from '@/test/fixtures'

function setup(respond: () => Response) {
  const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(respond()))
  const client = createApiClient({
    baseUrl: 'https://api.test',
    getToken: () => Promise.resolve('tok'),
    getSelectedOrganizationId: () => 'org',
    fetchImpl,
  })
  const sent = () => {
    const [input, init] = fetchImpl.mock.calls[0] ?? []
    if (input === undefined) throw new Error('No request was made')
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    return { method: init?.method ?? 'GET', path: url.pathname, body }
  }
  return { client, sent }
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status })
const input: RuleInput = {
  name: 'Delivery',
  enabled: true,
  applies_to: 'dm',
  keywords: ['delivery'],
  keyword_match: 'any',
  action: 'reply',
  reply_text: 'We deliver.',
  private_reply_text: null,
  handoff_reason: null,
}

describe('rule schema', () => {
  it('parses every scope, action and handoff reason the backend can send', () => {
    for (const applies_to of RULE_SCOPES) {
      expect(ruleSchema.safeParse(ruleWire({ applies_to })).success).toBe(true)
    }
    for (const action of RULE_ACTIONS) {
      expect(ruleSchema.safeParse(ruleWire({ action })).success).toBe(true)
    }
    for (const handoff_reason of [...HANDOFF_REASONS, null]) {
      expect(ruleSchema.safeParse(ruleWire({ handoff_reason })).success).toBe(true)
    }
  })

  it.each([
    ['an unknown channel', { applies_to: 'story' }],
    ['an unknown action', { action: 'like' }],
    ['an unknown match mode', { keyword_match: 'most' }],
    ['an unknown reason', { handoff_reason: 'vip' }],
    ['a negative priority', { priority: -1 }],
    ['a missing id', { id: 'not-a-uuid' }],
    ['keywords that are not a list', { keywords: 'delivery' }],
  ])('rejects %s instead of showing something wrong', (_name, change) => {
    expect(ruleSchema.safeParse(ruleWire(change)).success).toBe(false)
  })
})

describe('rule requests', () => {
  it('lists rules in the order the server returns them', async () => {
    const a = ruleWire({ name: 'a' })
    const b = ruleWire({ name: 'b' })
    const { client, sent } = setup(json({ items: [a, b], next_cursor: null }))
    const rules = await fetchRules(client)
    expect(rules.map((rule) => rule.name)).toEqual(['a', 'b'])
    expect(sent()).toMatchObject({ method: 'GET', path: '/api/v1/automations' })
  })

  it('creates with POST and the whole rule', async () => {
    const { client, sent } = setup(json(ruleWire(), 201))
    await createRule(client, input)
    expect(sent()).toEqual({ method: 'POST', path: '/api/v1/automations', body: input })
  })

  it('replaces with PUT to the rule, sending the whole rule', async () => {
    const wire = ruleWire()
    const { client, sent } = setup(json(wire))
    await replaceRule(client, wire.id, input)
    expect(sent()).toEqual({ method: 'PUT', path: `/api/v1/automations/${wire.id}`, body: input })
  })

  it('deletes with DELETE and accepts an empty answer', async () => {
    const { client, sent } = setup(() => new Response(null, { status: 204 }))
    await expect(
      deleteRule(client, '00000000-0000-4000-8000-000000000009'),
    ).resolves.toBeUndefined()
    expect(sent()).toMatchObject({
      method: 'DELETE',
      path: '/api/v1/automations/00000000-0000-4000-8000-000000000009',
    })
  })

  it('reorders by sending every id, and returns the new order', async () => {
    const a = ruleWire()
    const b = ruleWire()
    const { client, sent } = setup(json({ items: [b, a], next_cursor: null }))
    const rules = await reorderRules(client, [b.id, a.id])
    expect(rules.map((rule) => rule.id)).toEqual([b.id, a.id])
    expect(sent()).toEqual({
      method: 'PUT',
      path: '/api/v1/automations/order',
      body: { ids: [b.id, a.id] },
    })
  })

  it('previews a made-up message', async () => {
    const wire = ruleWire()
    const { client, sent } = setup(json({ rule: wire }))
    const result = await previewRule(client, 'comment', 'is it free?')
    expect(result.rule?.id).toBe(wire.id)
    expect(sent()).toEqual({
      method: 'POST',
      path: '/api/v1/automations/preview',
      body: { scope: 'comment', text: 'is it free?' },
    })
  })

  it('reads "no rule" as null, not as a failure', async () => {
    const { client } = setup(json({ rule: null }))
    await expect(previewRule(client, 'dm', 'hello')).resolves.toEqual({ rule: null })
  })
})
