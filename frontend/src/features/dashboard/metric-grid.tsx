import type { AnalyticsOverview } from '@/api/analytics'
import { Card } from '@/components/ui/card'
import { formatCount } from '@/lib/format'

export function MetricGrid({ overview }: { overview: AnalyticsOverview }) {
  const metrics = [
    { label: 'Messages received', value: overview.messages.inbound },
    { label: 'Replies sent by AI', value: overview.automation.ai_replies_sent },
    { label: 'New conversations', value: overview.conversations.new },
    { label: 'New leads', value: overview.conversations.new_leads },
    { label: 'Handoffs to a person', value: overview.automation.handoffs_opened },
  ]
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {metrics.map(({ label, value }) => (
        <Card key={label} className="p-5">
          <dt className="text-ink-muted text-sm">{label}</dt>
          <dd className="font-display text-ink mt-2 text-3xl font-medium tracking-tight">
            {formatCount(value)}
          </dd>
        </Card>
      ))}
    </dl>
  )
}
