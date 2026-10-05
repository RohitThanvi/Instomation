import { tenantKey } from '@/api/keys'
import type { ConversationFilters } from '@/api/conversations'

/** All inbox data is tenant-keyed, so switching workspaces can never show another's rows. */
export const inboxKeys = {
  lists: (organizationId: string) => tenantKey(organizationId, 'conversations', 'list'),
  list: (organizationId: string, filters: ConversationFilters) =>
    tenantKey(organizationId, 'conversations', 'list', JSON.stringify(filters)),
  detail: (organizationId: string, id: string) =>
    tenantKey(organizationId, 'conversations', 'detail', id),
  messages: (organizationId: string, id: string) =>
    tenantKey(organizationId, 'conversations', 'messages', id),
}
