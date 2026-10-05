import type { ReactNode } from 'react'
import type { Conversation, Priority } from '@/api/conversations'
import { PRIORITIES } from '@/api/conversations'
import { useRequiredOrganization } from '@/auth/session-context'
import { Avatar } from '@/components/ui/avatar'
import { controlClasses } from '@/components/ui/input'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { cn } from '@/lib/cn'
import { formatMessageTime } from '@/lib/format'
import {
  assigneeLabel,
  customerHandle,
  customerName,
  INTENT_LABELS,
  PRIORITY_LABELS,
  showsHandleSeparately,
  STATE_LABELS,
  STATE_TONES,
} from './labels'
import { TagEditor } from './tag-editor'
import { useConversationActions } from './use-inbox'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-ink-muted text-xs font-medium tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink text-right">{children}</dd>
    </div>
  )
}

function LeadSwitch({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Lead"
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60',
        checked ? 'bg-accent-600' : 'bg-line-strong',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'bg-surface shadow-card absolute left-0.5 size-5 rounded-full transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  )
}

/** Everything here edits the conversation through the API; the UI shows the server's value. */
export function CustomerContext({ conversation }: { conversation: Conversation }) {
  const { role } = useRequiredOrganization()
  const { update } = useConversationActions(conversation.id)
  const name = customerName(conversation.customer)
  const handle = customerHandle(conversation.customer)

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={name} size="lg" />
        <div className="min-w-0">
          <p className="text-ink truncate font-medium">{name}</p>
          {handle !== null && showsHandleSeparately(conversation.customer) && (
            <p className="text-ink-muted truncate text-sm">{handle}</p>
          )}
        </div>
      </div>

      <Section title="Conversation">
        <dl className="space-y-3">
          <Row label="Status">
            <StatusIndicator
              tone={STATE_TONES[conversation.state]}
              label={STATE_LABELS[conversation.state]}
            />
          </Row>
          <Row label="Assigned to">{assigneeLabel(role, conversation)}</Row>
          <Row label="Latest topic">
            {conversation.last_intent === null ? (
              <span className="text-ink-subtle">Not detected yet</span>
            ) : (
              INTENT_LABELS[conversation.last_intent]
            )}
          </Row>
          <Row label="Started">
            <time dateTime={conversation.created_at}>
              {formatMessageTime(conversation.created_at)}
            </time>
          </Row>
        </dl>
      </Section>

      <Section title="Lead">
        <div className="flex items-center justify-between gap-3">
          <p className="text-ink-muted text-sm">
            {conversation.is_lead ? 'Marked as a lead.' : 'Not marked as a lead.'}
          </p>
          <LeadSwitch
            checked={conversation.is_lead}
            disabled={update.isPending}
            onToggle={() => {
              update.mutate({ is_lead: !conversation.is_lead })
            }}
          />
        </div>
      </Section>

      <Section title="Priority">
        <select
          aria-label="Priority"
          value={conversation.priority}
          disabled={update.isPending}
          onChange={(event) => {
            update.mutate({ priority: event.target.value as Priority })
          }}
          className={cn(controlClasses, 'h-9')}
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Tags">
        <TagEditor
          tags={conversation.tags}
          busy={update.isPending}
          onChange={(tags) => {
            update.mutate({ tags })
          }}
        />
      </Section>

      <Section title="Summary">
        {conversation.summary === null ? (
          <p className="text-ink-subtle text-sm">No summary yet.</p>
        ) : (
          <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">
            {conversation.summary}
          </p>
        )}
      </Section>
    </div>
  )
}
