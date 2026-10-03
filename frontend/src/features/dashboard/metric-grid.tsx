import type { DashboardOverview } from '@/api/analytics'
import { Card } from '@/components/ui/card'
import { formatCount, formatPercent } from '@/lib/format'

export function MetricGrid({ totals }: { totals: DashboardOverview['totals'] }) {
  const metrics = [
    { label: 'Messages received', value: formatCount(totals.messages_received) },
    { label: 'Replies sent by AI', value: formatCount(totals.ai_replies_sent) },
    { label: 'Open conversations', value: formatCount(totals.open_conversations) },
    { label: 'Leads captured', value: formatCount(totals.leads_captured) },
    { label: 'Handled without a person', value: formatPercent(totals.automation_rate) },
  ]
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {metrics.map(({ label, value }) => (
        <Card key={label} className="p-5">
          <dt className="text-ink-muted text-sm">{label}</dt>
          <dd className="font-display text-ink mt-2 text-3xl font-medium tracking-tight">
            {value}
          </dd>
        </Card>
      ))}
    </dl>
  )
}
