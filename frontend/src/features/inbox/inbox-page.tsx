import { MessageSquare } from 'lucide-react'
import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ConversationListPane } from './conversation-list'
import { ConversationWorkspace } from './conversation-workspace'
import { parseFilters, toSearchParams, type InboxFilters } from './filters'

export function InboxPage() {
  const { conversationId } = useParams()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => parseFilters(params), [params])

  function changeFilters(next: InboxFilters) {
    setParams(toSearchParams(next), { replace: true })
  }

  return (
    <div className="animate-fade-in grid h-[calc(100dvh-8rem)] min-h-[34rem] grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_18rem]">
      <ConversationListPane
        filters={filters}
        onFiltersChange={changeFilters}
        selectedId={conversationId}
        className={conversationId === undefined ? 'flex' : 'hidden lg:flex'}
      />
      {conversationId === undefined ? (
        <div className="border-line-strong text-ink-muted hidden place-items-center rounded-lg border border-dashed p-8 text-center lg:grid xl:col-span-2">
          <div className="space-y-2">
            <MessageSquare className="text-ink-subtle mx-auto size-8" aria-hidden />
            <p className="text-ink font-medium">Select a conversation</p>
            <p className="text-sm">Choose one from the list to read it and reply.</p>
          </div>
        </div>
      ) : (
        <ConversationWorkspace key={conversationId} id={conversationId} />
      )}
    </div>
  )
}
