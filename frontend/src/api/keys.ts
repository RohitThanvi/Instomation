export const queryKeys = {
  organizations: ['organizations'] as const,
} as const

/** Tenant data is always keyed by organization, so switching workspaces can never show stale rows. */
export function tenantKey(organizationId: string, ...parts: readonly string[]): readonly string[] {
  return ['tenant', organizationId, ...parts]
}
