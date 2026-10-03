import type { MemberRole } from '@/api/schemas'

/** Mirrors `backend/app/core/rbac.py`. The server stays authoritative (403); this only shapes the UI. */
export const PERMISSIONS = [
  'org_manage',
  'billing_manage',
  'members_manage',
  'settings_manage',
  'automation_manage',
  'analytics_view',
  'conversations_all',
  'conversations_assigned',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const ALL: readonly Permission[] = PERMISSIONS
const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== 'org_manage' && p !== 'billing_manage'),
  manager: ['automation_manage', 'analytics_view', 'conversations_all', 'conversations_assigned'],
  staff: ['conversations_assigned'],
}

export function can(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}
