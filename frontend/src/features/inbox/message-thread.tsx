import { useEffect, useRef } from 'react'
import { Notice } from '@/components/ui/notice'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { MAX_THREAD_PAGES, MESSAGE_PAGE_SIZE } from '@/config/constants'
import { MessageItem } from './message-item'
import { useThread } from './use-inbox'

const NEAR_BOTTOM_PX = 96

export function MessageThread({ conversationId }: { conversationId: string }) {
  const thread = useThread(conversationId)
  const scroller = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const count = thread.data?.items.length ?? 0

  // Stay pinned to the newest message unless the reader has scrolled up to read history.
  useEffect(() => {
    const element = scroller.current
    if (element !== null && followLatest.current) element.scrollTop = element.scrollHeight
  }, [count])

  function trackScroll() {
    const element = scroller.current
    if (element === null) return
    followLatest.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX
  }

  if (thread.isPending) {
    return (
      <div className="flex-1 space-y-3 p-4" role="status" aria-label="Loading messages">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-10 w-3/5" />
      </div>
    )
  }
  if (thread.isError) {
    return (
      <div className="flex-1 p-4">
        <ErrorState
          error={thread.error}
          title="We could not load this conversation"
          onRetry={() => void thread.refetch()}
        />
      </div>
    )
  }
  if (thread.data.items.length === 0) {
    return (
      <div className="flex-1 p-4">
        <EmptyState
          title="No messages yet"
          description="Messages from this customer will appear here."
        />
      </div>
    )
  }

  return (
    <div
      ref={scroller}
      onScroll={trackScroll}
      role="log"
      aria-label="Messages"
      className="flex-1 space-y-4 overflow-y-auto p-4"
    >
      {thread.data.truncated && (
        <Notice tone="info" title="Showing the first part of a long conversation">
          Only the first {(MAX_THREAD_PAGES * MESSAGE_PAGE_SIZE).toLocaleString('en-US')} messages
          are loaded.
        </Notice>
      )}
      {thread.data.items.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </div>
  )
}
