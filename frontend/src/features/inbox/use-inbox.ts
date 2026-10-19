import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  addNote,
  fetchConversation,
  fetchConversations,
  fetchThread,
  handBackConversation,
  resolveConversation,
  sendReply,
  takeOverConversation,
  updateConversation,
  type Conversation,
  type ConversationFilters,
  type ConversationPatch,
} from '@/api/conversations'
import { useRequiredOrganization, useSession } from '@/auth/session-context'
import { INBOX_LIST_REFETCH_MS, THREAD_REFETCH_MS } from '@/config/constants'
import { handoffKeys } from '@/features/handoffs/handoff-keys'
import { inboxKeys } from './inbox-keys'
import { threadPollInterval } from './polling'

export function useConversationList(filters: ConversationFilters) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useInfiniteQuery({
    queryKey: inboxKeys.list(organization.id, filters),
    queryFn: ({ pageParam, signal }) => fetchConversations(client, filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    refetchInterval: INBOX_LIST_REFETCH_MS,
  })
}

/**
 * Fetching a conversation marks it read on the server, so once it loads the list is refreshed
 * to clear the unread badge.
 */
export function useConversationDetail(id: string) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: inboxKeys.detail(organization.id, id),
    queryFn: ({ signal }) => fetchConversation(client, id, signal),
    refetchInterval: THREAD_REFETCH_MS,
  })

  const loaded = query.isSuccess
  useEffect(() => {
    if (loaded) {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.lists(organization.id) })
    }
  }, [loaded, id, organization.id, queryClient])

  return query
}

export function useThread(id: string) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useQuery({
    queryKey: inboxKeys.messages(organization.id, id),
    queryFn: ({ signal }) => fetchThread(client, id, signal),
    refetchInterval: (query) => threadPollInterval(query.state.data?.items),
  })
}

/**
 * Every action returns the updated conversation, which replaces the cached copy immediately;
 * lists are then refetched. There are no optimistic updates: the UI shows what the server says.
 * Failures surface through the app-wide mutation error toast.
 */
export function useConversationActions(id: string) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  const queryClient = useQueryClient()

  function refreshAfterChange(updated?: Conversation) {
    if (updated !== undefined) {
      queryClient.setQueryData(inboxKeys.detail(organization.id, id), updated)
    }
    void queryClient.invalidateQueries({ queryKey: inboxKeys.lists(organization.id) })
    // Taking over, handing back and resolving all move the handoff queue.
    void queryClient.invalidateQueries({ queryKey: handoffKeys.all(organization.id) })
  }

  function refreshAfterMessage() {
    void queryClient.invalidateQueries({ queryKey: inboxKeys.messages(organization.id, id) })
    void queryClient.invalidateQueries({ queryKey: inboxKeys.detail(organization.id, id) })
    void queryClient.invalidateQueries({ queryKey: inboxKeys.lists(organization.id) })
  }

  /** The server's view may have moved on (for example, the conversation was handed back). */
  function resync() {
    void queryClient.invalidateQueries({ queryKey: inboxKeys.detail(organization.id, id) })
    void queryClient.invalidateQueries({ queryKey: inboxKeys.messages(organization.id, id) })
  }

  return {
    takeOver: useMutation({
      mutationFn: () => takeOverConversation(client, id),
      onSuccess: refreshAfterChange,
    }),
    handBack: useMutation({
      mutationFn: () => handBackConversation(client, id),
      onSuccess: refreshAfterChange,
    }),
    resolve: useMutation({
      mutationFn: () => resolveConversation(client, id),
      onSuccess: refreshAfterChange,
    }),
    update: useMutation({
      mutationFn: (patch: ConversationPatch) => updateConversation(client, id, patch),
      onSuccess: refreshAfterChange,
    }),
    reply: useMutation({
      mutationFn: (body: string) => sendReply(client, id, body),
      onSuccess: refreshAfterMessage,
      onError: resync,
    }),
    note: useMutation({
      mutationFn: (body: string) => addNote(client, id, body),
      onSuccess: refreshAfterMessage,
    }),
  }
}
