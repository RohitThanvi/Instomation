import type { DashboardOverview } from '@/api/analytics'
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

/** Test-only sample matching the UI's expected analytics contract. Never imported by app code. */
export const DASHBOARD_OVERVIEW: DashboardOverview = {
  range: '30d',
  totals: {
    messages_received: 1240,
    ai_replies_sent: 880,
    open_conversations: 37,
    leads_captured: 52,
    automation_rate: 0.62,
  },
  messages_over_time: [
    { date: '2026-09-01', received: 40, ai_replies: 28, human_replies: 6 },
    { date: '2026-09-02', received: 55, ai_replies: 41, human_replies: 9 },
    { date: '2026-09-03', received: 31, ai_replies: 22, human_replies: 4 },
  ],
  conversations_by_state: { ai_active: 20, human_required: 5, human_active: 12, resolved: 60 },
}
