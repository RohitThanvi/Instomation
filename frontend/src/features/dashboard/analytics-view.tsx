import { lazy, Suspense } from 'react'
import { RANGE_LABELS } from './range-labels'
import type { DashboardOverview } from '@/api/analytics'
import { Skeleton } from '@/components/ui/skeleton'
import { ConversationStates } from './conversation-states'
import { MetricGrid } from './metric-grid'

// Recharts is the heaviest dependency here; only load it once there is data to draw.
const MessagesChart = lazy(async () => ({
  default: (await import('./messages-chart')).MessagesChart,
}))

export function AnalyticsView({ overview }: { overview: DashboardOverview }) {
  return (
    <div className="space-y-4">
      <p className="text-ink-muted text-sm">{RANGE_LABELS[overview.range]}</p>
      <MetricGrid totals={overview.totals} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<Skeleton className="h-80 lg:col-span-2" />}>
          <MessagesChart points={overview.messages_over_time} />
        </Suspense>
        <ConversationStates counts={overview.conversations_by_state} />
      </div>
    </div>
  )
}
