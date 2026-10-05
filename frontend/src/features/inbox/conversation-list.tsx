import { useState, type SyntheticEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CONVERSATION_STATES, PRIORITIES, type Conversation } from '@/api/conversations'
import { useRequiredOrganization } from '@/auth/session-context'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { controlClasses, Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { MAX_TAG_LENGTH, ROUTES } from '@/config/constants'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/format'
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  searchConversations,
  SORT_LABELS,
  SORTS,
  sortConversations,
  toServerFilters,
  type InboxFilters,
  type InboxSort,
} from './filters'
import { customerName, INTENT_LABELS, PRIORITY_LABELS, STATE_LABELS, STATE_TONES } from './labels'
import { useConversationList } from './use-inbox'

const SELECT_CLASSES = cn(controlClasses, 'h-9')
const SKELETON_ROWS = 5

interface FilterBarProps {
  filters: InboxFilters
  onChange: (filters: InboxFilters) => void
}

/** Commits on Enter or when focus leaves: the tag filter is applied by the server. */
function TagFilter({
  value,
  onCommit,
}: {
  value: string | undefined
  onCommit: (tag: string) => void
}) {
  const [text, setText] = useState(value ?? '')
  function commit(event?: SyntheticEvent) {
    event?.preventDefault()
    onCommit(text.trim())
  }
  return (
    <form onSubmit={commit} role="search" aria-label="Filter by tag">
      <Input
        aria-label="Filter by tag"
        placeholder="Tag (press Enter)"
        maxLength={MAX_TAG_LENGTH}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
        }}
        onBlur={() => {
          commit()
        }}
        className="h-9"
      />
    </form>
  )
}

function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="space-y-2">
      <Input
        type="search"
        aria-label="Search loaded conversations"
        placeholder="Search by name, tag or summary"
        value={filters.query}
        onChange={(event) => {
          onChange({ ...filters, query: event.target.value })
        }}
        className="h-9"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label="Status"
          value={filters.state ?? ''}
          onChange={(event) => {
            const state = CONVERSATION_STATES.find((candidate) => candidate === event.target.value)
            onChange({ ...filters, state })
          }}
          className={SELECT_CLASSES}
        >
          <option value="">All statuses</option>
          {CONVERSATION_STATES.map((state) => (
            <option key={state} value={state}>
              {STATE_LABELS[state]}
            </option>
          ))}
        </select>
        <select
          aria-label="Priority filter"
          value={filters.priority ?? ''}
          onChange={(event) => {
            const priority = PRIORITIES.find((candidate) => candidate === event.target.value)
            onChange({ ...filters, priority })
          }}
          className={SELECT_CLASSES}
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort by"
          value={filters.sort}
          onChange={(event) => {
            const sort = SORTS.find((candidate) => candidate === event.target.value)
            if (sort !== undefined) onChange({ ...filters, sort })
          }}
          className={SELECT_CLASSES}
        >
          {SORTS.map((sort: InboxSort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </select>
        <TagFilter
          key={filters.tag ?? ''}
          value={filters.tag}
          onCommit={(tag) => {
            onChange({ ...filters, tag: tag === '' ? undefined : tag })
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-ink flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.leadsOnly}
            onChange={(event) => {
              onChange({ ...filters, leadsOnly: event.target.checked })
            }}
            className="accent-accent-600 size-4"
          />
          Leads only
        </label>
        {hasActiveFilters(filters) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({ ...EMPTY_FILTERS, sort: filters.sort })
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}

function ConversationRow({
  conversation,
  selected,
}: {
  conversation: Conversation
  selected: boolean
}) {
  const { search } = useLocation()
  const name = customerName(conversation.customer)
  const activity = conversation.last_message_at ?? conversation.created_at
  const preview =
    conversation.summary ??
    (conversation.last_intent === null ? null : INTENT_LABELS[conversation.last_intent])
  const unread = selected ? 0 : conversation.unread_count

  return (
    <li>
      <Link
        to={`${ROUTES.inbox}/${conversation.id}${search}`}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex gap-3 rounded-md p-3 transition-colors',
          selected ? 'bg-accent-50' : 'hover:bg-sunken',
        )}
      >
        <Avatar name={name} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                'text-ink truncate text-sm',
                unread > 0 ? 'font-semibold' : 'font-medium',
              )}
            >
              {name}
            </span>
            <time dateTime={activity} className="text-ink-subtle shrink-0 text-xs">
              {formatRelativeTime(activity)}
            </time>
          </div>
          {preview !== null && <p className="text-ink-muted truncate text-xs">{preview}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusIndicator
              tone={STATE_TONES[conversation.state]}
              label={STATE_LABELS[conversation.state]}
            />
            {conversation.is_lead && <Badge tone="success">Lead</Badge>}
            {conversation.priority === 'high' && <Badge tone="danger">High priority</Badge>}
            {unread > 0 && (
              <span
                aria-label={`${unread} unread`}
                className="bg-accent-600 ml-auto grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-medium text-white"
              >
                {unread}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}

interface ConversationListPaneProps {
  filters: InboxFilters
  onFiltersChange: (filters: InboxFilters) => void
  selectedId: string | undefined
  className?: string
}

export function ConversationListPane({
  filters,
  onFiltersChange,
  selectedId,
  className,
}: ConversationListPaneProps) {
  const { role } = useRequiredOrganization()
  const list = useConversationList(toServerFilters(filters))
  const loaded = list.data?.pages.flatMap((page) => page.items) ?? []
  const visible = sortConversations(searchConversations(loaded, filters.query), filters.sort)

  return (
    <section
      aria-label="Conversations"
      className={cn(
        'border-line bg-surface shadow-card min-h-0 flex-col rounded-lg border',
        className,
      )}
    >
      <div className="border-line space-y-3 border-b p-3">
        <h1 className="font-display text-lg font-medium tracking-tight">Inbox</h1>
        <FilterBar filters={filters} onChange={onFiltersChange} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {list.isPending && (
          <div role="status" aria-label="Loading conversations" className="space-y-2">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        )}
        {list.isError && (
          <ErrorState
            error={list.error}
            title="We could not load your conversations"
            onRetry={() => void list.refetch()}
          />
        )}
        {list.isSuccess && visible.length > 0 && (
          <ul className="space-y-1">
            {visible.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
              />
            ))}
          </ul>
        )}
        {list.isSuccess && visible.length === 0 && (
          <EmptyState
            title={hasActiveFilters(filters) ? 'No conversations match' : 'No conversations yet'}
            description={
              hasActiveFilters(filters)
                ? list.hasNextPage
                  ? 'Nothing among the conversations loaded so far matches. Load more to search the rest.'
                  : 'Try changing or clearing your filters.'
                : role === 'staff'
                  ? 'Conversations assigned to you will appear here.'
                  : 'Conversations appear here when someone messages your connected Instagram account.'
            }
          />
        )}
      </div>

      {list.isSuccess && list.hasNextPage && (
        <div className="border-line space-y-2 border-t p-3 text-center">
          <p className="text-ink-subtle text-xs">
            Showing {loaded.length} conversations, oldest first. Load more to reach newer ones.
            Search and sorting only cover what is loaded.
          </p>
          <Button
            variant="secondary"
            size="sm"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </section>
  )
}
