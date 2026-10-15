import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  fetchKnowledgePage,
  searchKnowledge,
  updateKnowledgeEntry,
  type KnowledgeKind,
  type NewKnowledgeEntry,
} from '@/api/knowledge'
import { tenantKey } from '@/api/keys'
import { useRequiredOrganization, useSession } from '@/auth/session-context'

const PAGE_SIZE = 20

const knowledgeKeys = {
  all: (organizationId: string) => tenantKey(organizationId, 'knowledge'),
  list: (organizationId: string, kind: KnowledgeKind | null) =>
    [...tenantKey(organizationId, 'knowledge'), 'list', kind ?? 'all'] as const,
}

export function useKnowledgeList(kind: KnowledgeKind | null) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useInfiniteQuery({
    queryKey: knowledgeKeys.list(organization.id, kind),
    queryFn: ({ pageParam, signal }) =>
      fetchKnowledgePage(client, { kind, cursor: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  })
}

/** Failures surface through the app-wide mutation error toast, which carries the server's message. */
export function useKnowledgeMutations() {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: knowledgeKeys.all(organization.id) })

  return {
    create: useMutation({
      mutationFn: (entry: NewKnowledgeEntry) => createKnowledgeEntry(client, entry),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<NewKnowledgeEntry> }) =>
        updateKnowledgeEntry(client, id, patch),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteKnowledgeEntry(client, id),
      onSuccess: refresh,
    }),
  }
}

export function useKnowledgeSearch() {
  const { client } = useSession()
  return useMutation({ mutationFn: (query: string) => searchKnowledge(client, query) })
}
