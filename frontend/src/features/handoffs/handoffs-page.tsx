import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Handoff } from '@/api/handoffs'
import { useRequiredOrganization } from '@/auth/session-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/config/constants'
import { formatCount, formatRelativeTime } from '@/lib/format'
import { customerHandle, customerName, PRIORITY_LABELS } from '@/features/inbox/labels'
import type { HandoffView } from './handoff-keys'
import { REASON_LABELS, REASON_TONES, STATUS_LABELS, STATUS_TONES } from './labels'
import { useHandoffCounts, useHandoffList } from './use-handoffs'

const SKELETON_ROWS = 4

const VIEWS: readonly { view: HandoffView; label: string }[] = [
  { view: 'waiting', label: 'Needs attention' },
  { view: 'resolved', label: 'Resolved' },
]

export function HandoffsPage() {
  const { role } = useRequiredOrganization()
  const [view, setView] = useState<HandoffView>('waiting')
  const list = useHandoffList(view)
  const counts = useHandoffCounts()
  const handoffs = list.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="animate-fade-in space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-medium tracking-tight">Handoffs</h1>
        <p className="text-ink-muted max-w-xl">
          Conversations the assistant stopped answering because a person should take over. The
          longest-waiting come first.
        </p>
        {role === 'staff' && (
          <p className="text-ink-subtle text-sm">
            You see the handoffs on conversations assigned to you.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Show" className="flex gap-2">
          {VIEWS.map((option) => (
            <Button
              key={option.view}
              size="sm"
              variant={view === option.view ? 'primary' : 'secondary'}
              aria-pressed={view === option.view}
              onClick={() => {
                setView(option.view)
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {counts.data !== undefined && (
          <p className="text-ink-muted text-sm">
            {formatCount(counts.data.open)} waiting for a person ·{' '}
            {formatCount(counts.data.assigned)} being handled
          </p>
        )}
      </div>

      {list.isPending ? (
        <div className="space-y-3" aria-label="Loading handoffs">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState
          error={list.error}
          title="We could not load your handoffs"
          onRetry={() => void list.refetch()}
        />
      ) : handoffs.length === 0 ? (
        view === 'waiting' ? (
          <EmptyState
            title="Nothing is waiting for you"
            description="When the assistant hands a conversation to your team, it appears here."
          />
        ) : (
          <EmptyState
            title="No resolved handoffs yet"
            description="Handoffs your team has finished are kept here."
          />
        )
      ) : (
        <ul className="space-y-3">
          {handoffs.map((handoff) => (
            <HandoffRow key={handoff.id} handoff={handoff} />
          ))}
        </ul>
      )}

      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

function HandoffRow({ handoff }: { handoff: Handoff }) {
  const name = customerName(handoff.customer)
  const handle = customerHandle(handoff.customer)
  const resolved = handoff.status === 'resolved'
  const when = handoff.resolved_at ?? handoff.created_at
  return (
    <li>
      <Link
        to={`${ROUTES.inbox}/${handoff.conversation_id}`}
        className="focus-visible:ring-accent-500 block rounded-lg focus-visible:ring-2 focus-visible:outline-none"
      >
        <Card className="hover:bg-sunken flex gap-3 p-4 transition-colors">
          <Avatar name={name} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-ink truncate text-sm font-medium">
                {name}
                {handle !== null && handle !== name && (
                  <span className="text-ink-subtle ml-2 font-normal">{handle}</span>
                )}
              </span>
              <time dateTime={when} className="text-ink-subtle shrink-0 text-xs">
                {resolved ? 'Resolved' : 'Waiting'} {formatRelativeTime(when)}
              </time>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={REASON_TONES[handoff.reason]}>{REASON_LABELS[handoff.reason]}</Badge>
              <Badge tone={STATUS_TONES[handoff.status]}>{STATUS_LABELS[handoff.status]}</Badge>
              {handoff.conversation_priority === 'high' && (
                <Badge tone="warning">{PRIORITY_LABELS.high} priority</Badge>
              )}
            </div>
          </div>
        </Card>
      </Link>
    </li>
  )
}
