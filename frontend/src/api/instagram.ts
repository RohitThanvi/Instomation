import { z } from 'zod'
import type { ApiClient } from './client'
import { paginated } from './schemas'
import { API_PREFIX, PAGE_SIZE } from '@/config/constants'

export const ACCOUNT_STATUSES = ['active', 'token_expired', 'disconnected'] as const

export const instagramAccountSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  status: z.enum(ACCOUNT_STATUSES),
  granted_permissions: z.array(z.string()),
  webhook_subscribed: z.boolean(),
  token_expires_at: z.string().nullable(),
})
export type InstagramAccount = z.infer<typeof instagramAccountSchema>

const accountPageSchema = paginated(instagramAccountSchema)

export function fetchInstagramAccounts(
  client: ApiClient,
  cursor: string | null,
  signal?: AbortSignal,
) {
  return client.request({
    path: `${API_PREFIX}/instagram/accounts`,
    schema: accountPageSchema,
    query: { limit: PAGE_SIZE, cursor },
    signal,
  })
}

/** Feature ids exactly as the backend reports them. */
export const FEATURES = {
  commentReply: 'FEATURE_COMMENT_REPLY',
  dmReply: 'FEATURE_DM_REPLY',
  privateReply: 'FEATURE_PRIVATE_REPLY',
} as const
export type SupportedFeature = (typeof FEATURES)[keyof typeof FEATURES]

export const capabilitySchema = z.object({
  feature: z.string(),
  enabled: z.boolean(),
  reason: z.string().nullable(),
})
export type Capability = z.infer<typeof capabilitySchema>

export function fetchCapabilities(client: ApiClient, signal?: AbortSignal) {
  return client.request({
    path: `${API_PREFIX}/instagram/capabilities`,
    schema: z.array(capabilitySchema),
    signal,
  })
}

/** Unknown or absent features count as disabled: never advertise what the server did not confirm. */
export function isFeatureEnabled(capabilities: readonly Capability[], feature: string): boolean {
  return capabilities.some((capability) => capability.feature === feature && capability.enabled)
}

const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'Authorization URL must use https')
const oauthStartSchema = z.object({ authorization_url: httpsUrl })

export function startInstagramOAuth(client: ApiClient) {
  return client.request({
    method: 'POST',
    path: `${API_PREFIX}/instagram/oauth/start`,
    schema: oauthStartSchema,
  })
}
