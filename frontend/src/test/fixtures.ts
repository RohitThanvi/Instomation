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
