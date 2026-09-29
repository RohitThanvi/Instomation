import { z } from 'zod'

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next_cursor: z.string().nullable() })
}

export const ACCOUNT_TYPES = ['creator', 'business', 'agency', 'personal_brand', 'other'] as const
export const accountTypeSchema = z.enum(ACCOUNT_TYPES)
export type AccountType = z.infer<typeof accountTypeSchema>

export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'staff'] as const
export const memberRoleSchema = z.enum(MEMBER_ROLES)
export type MemberRole = z.infer<typeof memberRoleSchema>
