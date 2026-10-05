import { ArrowLeft, PanelRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { ROUTES } from '@/config/constants'
import { Composer } from './composer'
import { ConversationActions } from './conversation-actions'
import { CustomerContext } from './customer-context'
import {
  customerHandle,
  customerName,
  STATE_DESCRIPTIONS,
  STATE_LABELS,
  STATE_TONES,
} from './labels'
import { MessageThread } from './message-thread'
import { useConversationDetail } from './use-inbox'

const PANE = 'border-line bg-surface shadow-card min-h-0 rounded-lg border'

/** The conversation and customer-context panes for one selected conversation. */
export function ConversationWorkspace({ id }: { id: string }) {
  const { search } = useLocation()
  const detail = useConversationDetail(id)
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (detail.isPending) {
    return (
      <>
        <div className={`${PANE} p-4`} role="status" aria-label="Loading conversation">
          <Skeleton className="h-12 w-1/2" />
        </div>
        <div aria-hidden className={`${PANE} hidden xl:block`} />
      </>
    )
  }
  if (detail.isError) {
    return (
      <div className={`${PANE} col-span-full p-4 lg:col-span-1 xl:col-span-2`}>
        <ErrorState
          error={detail.error}
          title="We could not open this conversation"
          onRetry={() => void detail.refetch()}
        />
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <Link to={`${ROUTES.inbox}${search}`}>Back to inbox</Link>
        </Button>
      </div>
    )
  }

  const conversation = detail.data
  const name = customerName(conversation.customer)
  const handle = customerHandle(conversation.customer)

  return (
    <>
      <section aria-label="Conversation" className={`${PANE} flex flex-col overflow-hidden`}>
        <header className="border-line space-y-3 border-b p-4">
          <div className="flex items-start gap-3">
            <Button asChild variant="ghost" size="sm" className="-ml-2 lg:hidden">
              <Link to={`${ROUTES.inbox}${search}`} aria-label="Back to inbox">
                <ArrowLeft className="size-4" aria-hidden />
              </Link>
            </Button>
            <Avatar name={name} />
            <div className="min-w-0 flex-1">
              <h2 className="text-ink truncate font-medium">{name}</h2>
              {handle !== null && <p className="text-ink-muted truncate text-sm">{handle}</p>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="xl:hidden"
              aria-expanded={detailsOpen}
              onClick={() => {
                setDetailsOpen((open) => !open)
              }}
            >
              <PanelRight className="size-4" aria-hidden />
              Details
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusIndicator
              tone={STATE_TONES[conversation.state]}
              label={STATE_LABELS[conversation.state]}
            />
            <p className="text-ink-muted text-sm">{STATE_DESCRIPTIONS[conversation.state]}</p>
          </div>
          <ConversationActions conversation={conversation} />
        </header>

        {detailsOpen && (
          <div className="border-line max-h-80 overflow-y-auto border-b xl:hidden">
            <CustomerContext conversation={conversation} />
          </div>
        )}

        <MessageThread conversationId={conversation.id} />
        <Composer key={conversation.id} conversation={conversation} />
      </section>

      <aside aria-label="Customer details" className={`${PANE} hidden overflow-y-auto xl:block`}>
        <CustomerContext conversation={conversation} />
      </aside>
    </>
  )
}
