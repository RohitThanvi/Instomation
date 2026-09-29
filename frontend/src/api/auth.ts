import { z } from 'zod'
import type { ApiClient } from './client'
import { API_PREFIX } from '@/config/constants'

export const identitySchema = z.object({ clerk_user_id: z.string().min(1) })
export type Identity = z.infer<typeof identitySchema>

export function fetchIdentity(client: ApiClient, signal?: AbortSignal): Promise<Identity> {
  return client.request({ path: `${API_PREFIX}/auth/me`, schema: identitySchema, signal })
}
