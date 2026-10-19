import { tenantKey } from '@/api/keys'

export type HandoffView = 'waiting' | 'resolved'

/** Tenant-keyed like all server data, so switching workspaces never shows another's queue. */
export const handoffKeys = {
  all: (organizationId: string) => tenantKey(organizationId, 'handoffs'),
  list: (organizationId: string, view: HandoffView) =>
    tenantKey(organizationId, 'handoffs', 'list', view),
  counts: (organizationId: string) => tenantKey(organizationId, 'handoffs', 'counts'),
}
