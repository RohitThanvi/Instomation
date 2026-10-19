import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { fetchHandoffCounts, fetchHandoffsPage } from '@/api/handoffs'
import { useRequiredOrganization, useSession } from '@/auth/session-context'
import { INBOX_LIST_REFETCH_MS } from '@/config/constants'
import { handoffKeys, type HandoffView } from './handoff-keys'

/** The waiting queue is polled like the inbox; resolved history only changes when you look. */
export function handoffPollInterval(view: HandoffView): number | false {
  return view === 'waiting' ? INBOX_LIST_REFETCH_MS : false
}

export function useHandoffList(view: HandoffView) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useInfiniteQuery({
    queryKey: handoffKeys.list(organization.id, view),
    queryFn: ({ pageParam, signal }) =>
      fetchHandoffsPage(client, { resolved: view === 'resolved', cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    refetchInterval: handoffPollInterval(view),
  })
}

export function useHandoffCounts() {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useQuery({
    queryKey: handoffKeys.counts(organization.id),
    queryFn: ({ signal }) => fetchHandoffCounts(client, signal),
    refetchInterval: INBOX_LIST_REFETCH_MS,
  })
}
