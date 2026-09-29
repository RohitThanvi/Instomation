import { z } from 'zod'
import type { ApiClient } from './client'
import { accountTypeSchema, memberRoleSchema, paginated } from './schemas'
import { API_PREFIX, PAGE_SIZE } from '@/config/constants'

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  account_type: accountTypeSchema,
  role: memberRoleSchema,
})
export type Organization = z.infer<typeof organizationSchema>

const organizationPageSchema = paginated(organizationSchema)
export type OrganizationPage = z.infer<typeof organizationPageSchema>

export function fetchOrganizations(
  client: ApiClient,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<OrganizationPage> {
  return client.request({
    path: `${API_PREFIX}/organizations`,
    schema: organizationPageSchema,
    query: { limit: PAGE_SIZE, cursor },
    signal,
  })
}

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Give your workspace a name').max(200),
  account_type: accountTypeSchema,
})
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>

export function createOrganization(
  client: ApiClient,
  input: CreateOrganizationInput,
): Promise<Organization> {
  return client.request({
    method: 'POST',
    path: `${API_PREFIX}/organizations`,
    schema: organizationSchema,
    body: input,
  })
}
