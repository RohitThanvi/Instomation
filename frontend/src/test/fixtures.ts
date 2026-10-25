import type { AnalyticsOverview } from '@/api/analytics'
import type { Organization } from '@/api/organizations'

export const ORG_ID = '3f0c2a9e-6d4b-4c1a-9b7e-1a2b3c4d5e6f'

export function organization(overrides: Partial<Organization> = {}): Organization {
  return { id: ORG_ID, name: 'Acme Studio', account_type: 'business', role: 'owner', ...overrides }
}

/** Shape of `GET /api/v1/instagram/capabilities` (feature ids as the backend sends them). */
export const CAPABILITIES_WIRE = [
  { feature: 'FEATURE_COMMENT_REPLY', enabled: true, reason: null },
  {
    feature: 'FEATURE_COMMENT_LIKE',
    enabled: false,
    reason: "Not exposed by Meta's official Instagram API.",
  },
  { feature: 'FEATURE_DM_REPLY', enabled: true, reason: null },
  { feature: 'FEATURE_PRIVATE_REPLY', enabled: true, reason: null },
  {
    feature: 'FEATURE_PROFILE_BIO_UPDATE',
    enabled: false,
    reason: "Not exposed by Meta's official Instagram API.",
  },
  {
    feature: 'FEATURE_PROFILE_PHOTO_UPDATE',
    enabled: false,
    reason: "Not exposed by Meta's official Instagram API.",
  },
]

export function accountWire(overrides: Record<string, unknown> = {}) {
  return {
    id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
    username: 'acme.studio',
    status: 'active',
    granted_permissions: ['instagram_business_basic'],
    webhook_subscribed: true,
    token_expires_at: null,
    ...overrides,
  }
}

/**
 * `GET /api/v1/analytics/overview` as the backend serializes it. Internally consistent on
 * purpose: the daily series sums to the message totals (outgoing includes the 2 AI messages that
 * failed, so `outbound_ai` is 93 while `ai_replies_sent` is 91, as in real data) and handoff reasons
 * sum to the total.
 */
export const ANALYTICS_OVERVIEW: AnalyticsOverview = {
  range: { start: '2026-09-01', end: '2026-09-03' },
  conversations: {
    new: 18,
    new_leads: 7,
    by_state: { ai_active: 20, human_required: 5, human_active: 12, resolved: 60 },
  },
  messages: { inbound: 126, outbound_ai: 93, outbound_human: 19, outbound_failed: 2 },
  automation: {
    ai_replies_sent: 91,
    handoffs_opened: 9,
    handoffs_resolved: 6,
    handoffs_by_reason: { customer_requested: 4, complaint: 3, low_confidence: 2 },
  },
  moderation: {
    allowed: 130,
    blocked: 6,
    escalated: 3,
    blocked_by_category: { spam: 5, offensive: 1 },
  },
  daily: [
    { date: '2026-09-01', inbound: 40, outbound: 34 },
    { date: '2026-09-02', inbound: 55, outbound: 50 },
    { date: '2026-09-03', inbound: 31, outbound: 28 },
  ],
}

/** A valid v4-shaped UUID derived from a number, so fixtures stay readable and unique. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`
}

export const CONVERSATION_ID = uuid(100)
export const CUSTOMER_ID = uuid(200)
export const TEAMMATE_ID = uuid(300)

/** `ConversationOut` exactly as the backend serializes it (lowercase enums, `Z` timestamps). */
export function conversationWire(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    instagram_account_id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
    customer: {
      id: CUSTOMER_ID,
      external_user_id: '17841400000000001',
      username: 'maya.k',
      display_name: 'Maya Kapoor',
    },
    state: 'ai_active',
    priority: 'normal',
    last_intent: 'price_query',
    is_lead: false,
    tags: [] as string[],
    summary: null,
    unread_count: 2,
    assigned_user_id: null,
    last_message_at: '2026-10-04T09:30:00.123456Z',
    created_at: '2026-10-03T08:00:00.000000Z',
    ...overrides,
  }
}

let messageCounter = 1000

/** `MessageOut` as the backend serializes it. Defaults to an inbound customer message. */
export function messageWire(overrides: Record<string, unknown> = {}) {
  messageCounter += 1
  return {
    id: uuid(messageCounter),
    direction: 'inbound',
    origin: 'customer',
    // Like the backend: a note has no channel, everything else defaults to a direct message.
    channel: overrides.origin === 'internal_note' ? null : 'dm',
    body: 'Hi! How much is the starter kit?',
    status: 'received',
    intent: null,
    ai_confidence: null,
    author_user_id: null,
    created_at: '2026-10-04T09:00:00.000000Z',
    ...overrides,
  }
}

let handoffCounter = 5000

/** `HandoffOut` as the backend serializes it. Defaults to an open handoff on the fixture conversation. */
export function handoffWire(overrides: Record<string, unknown> = {}) {
  handoffCounter += 1
  return {
    id: uuid(handoffCounter),
    conversation_id: CONVERSATION_ID,
    customer: conversationWire().customer,
    conversation_state: 'human_required',
    conversation_priority: 'normal',
    reason: 'customer_requested',
    status: 'open',
    assigned_user_id: null,
    created_at: '2026-10-04T09:30:00.123456Z',
    resolved_at: null,
    ...overrides,
  }
}

/** `BusinessProfileOut` as the backend serializes it. */
export function businessProfileWire(overrides: Record<string, unknown> = {}) {
  return {
    brand_name: 'Glow Studio',
    description: 'Handmade skincare from Jaipur.',
    industry: 'Skincare',
    location: 'Jaipur',
    website: 'https://glow.example',
    contact_info: { Email: 'hi@glow.example' },
    policies: { Returns: 'Free returns within 30 days' },
    communication_style: 'friendly',
    custom_instructions: 'Sign off with a flower.',
    ...overrides,
  }
}

/** `AiSettingsOut` as the backend serializes it. */
export function aiSettingsWire(overrides: Record<string, unknown> = {}) {
  return {
    dm_automation_enabled: true,
    comment_automation_enabled: true,
    private_reply_enabled: false,
    confidence_threshold: 0.7,
    max_response_tokens: 300,
    temperature: 0.4,
    max_replies_per_conversation_per_hour: 10,
    ...overrides,
  }
}

/** `UsageReport` as the backend serializes it: costs are fixed-point strings, days are zero-filled. */
export function usageReportWire(overrides: Record<string, unknown> = {}) {
  return {
    range: { start: '2026-10-01', end: '2026-10-03' },
    totals: {
      requests: 1240,
      input_tokens: 812_345,
      output_tokens: 98_765,
      estimated_cost: '1.234500',
    },
    failed_requests: 3,
    unpriced_requests: 0,
    average_latency_ms: 842,
    by_purpose: [
      {
        purpose: 'dm_reply',
        requests: 900,
        input_tokens: 600_000,
        output_tokens: 80_000,
        estimated_cost: '1.000000',
      },
      {
        purpose: 'comment_reply',
        requests: 240,
        input_tokens: 150_000,
        output_tokens: 15_000,
        estimated_cost: '0.200000',
      },
      {
        purpose: 'moderation',
        requests: 100,
        input_tokens: 62_345,
        output_tokens: 3_765,
        estimated_cost: '0.034500',
      },
    ],
    by_model: [
      {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        requests: 1100,
        input_tokens: 700_000,
        output_tokens: 90_000,
        estimated_cost: '1.100000',
      },
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        requests: 140,
        input_tokens: 112_345,
        output_tokens: 8_765,
        estimated_cost: '0.134500',
      },
    ],
    daily: [
      { date: '2026-10-01', requests: 400, estimated_cost: '0.400000' },
      { date: '2026-10-02', requests: 0, estimated_cost: '0' },
      { date: '2026-10-03', requests: 840, estimated_cost: '0.834500' },
    ],
    ...overrides,
  }
}
