import { ArrowDown, ArrowUp } from 'lucide-react'
import { useState } from 'react'
import type { Rule } from '@/api/automations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { REASON_LABELS } from '@/features/handoffs/labels'
import { ACTION_LABELS, describeAction, MATCH_LABELS, SCOPE_LABELS } from './labels'

interface RuleCardProps {
  rule: Rule
  /** Where the rule is tried: 1 is first. */
  position: number
  count: number
  busy: boolean
  onMove: (direction: -1 | 1) => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}

export function RuleCard({
  rule,
  position,
  count,
  busy,
  onMove,
  onToggle,
  onEdit,
  onDelete,
}: RuleCardProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink-subtle text-sm tabular-nums">#{position}</span>
              <h3 className="text-ink text-base font-medium">{rule.name}</h3>
              {!rule.enabled && <Badge tone="warning">Paused</Badge>}
              <Badge tone="neutral">{SCOPE_LABELS[rule.applies_to]}</Badge>
              <Badge tone={rule.action === 'reply' ? 'info' : 'neutral'}>
                {ACTION_LABELS[rule.action]}
              </Badge>
              {rule.action === 'handoff' && rule.handoff_reason !== null && (
                <Badge tone="neutral">{REASON_LABELS[rule.handoff_reason]}</Badge>
              )}
            </div>
            <p className="text-ink-muted text-sm">
              When a message contains {MATCH_LABELS[rule.keyword_match]}:{' '}
              <span className="text-ink">
                {rule.keywords.map((keyword) => `“${keyword}”`).join(', ')}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || position === 1}
              aria-label={`Move “${rule.name}” up`}
              onClick={() => {
                onMove(-1)
              }}
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || position === count}
              aria-label={`Move “${rule.name}” down`}
              onClick={() => {
                onMove(1)
              }}
            >
              <ArrowDown className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <p className="text-ink-subtle text-sm">{describeAction(rule)}</p>
        {rule.reply_text !== null && (
          <blockquote className="border-line text-ink-muted border-l-2 pl-3 text-sm whitespace-pre-wrap">
            {rule.reply_text}
          </blockquote>
        )}
        {rule.private_reply_text !== null && (
          <blockquote className="border-line text-ink-muted border-l-2 pl-3 text-sm whitespace-pre-wrap">
            <span className="text-ink-subtle block text-xs">Private message</span>
            {rule.private_reply_text}
          </blockquote>
        )}

        {confirming ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink text-sm">
              Delete “{rule.name}”? Messages it already sent stay in the inbox.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirming(false)
                }}
              >
                Keep it
              </Button>
              <Button size="sm" loading={busy} onClick={onDelete}>
                Delete rule
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={onToggle}>
              {rule.enabled ? 'Pause' : 'Turn on'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(true)
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </Card>
    </li>
  )
}
