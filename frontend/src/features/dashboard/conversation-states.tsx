import type { ConversationStateCounts } from '@/api/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCount } from '@/lib/format'

const STATES: readonly { key: keyof ConversationStateCounts; label: string; bar: string }[] = [
  { key: 'ai_active', label: 'Handled by AI', bar: 'bg-accent-500' },
  { key: 'human_required', label: 'Needs a person', bar: 'bg-warning-600' },
  { key: 'human_active', label: 'With a person', bar: 'bg-info-600' },
  { key: 'resolved', label: 'Resolved', bar: 'bg-success-600' },
]

export function ConversationStates({ counts }: { counts: ConversationStateCounts }) {
  const total = STATES.reduce((sum, { key }) => sum + counts[key], 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversations</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-ink-muted text-sm">No conversations in this period.</p>
        ) : (
          <ul className="space-y-4">
            {STATES.map(({ key, label, bar }) => (
              <li key={key} className="space-y-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink">{label}</span>
                  <span className="text-ink-muted tabular-nums">{formatCount(counts[key])}</span>
                </div>
                <div aria-hidden className="bg-sunken h-1.5 overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full ${bar}`}
                    style={{ width: `${(counts[key] / total) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
