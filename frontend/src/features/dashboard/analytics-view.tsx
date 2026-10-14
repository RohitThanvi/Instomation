import { lazy, Suspense } from 'react'
import type { AnalyticsOverview } from '@/api/analytics'
import { Skeleton } from '@/components/ui/skeleton'
import { formatShortDate } from '@/lib/format'
import { ConversationStates } from './conversation-states'
import { MetricGrid } from './metric-grid'

// Recharts is the heaviest dependency here; only load it once there is data to draw.
const MessagesChart = lazy(async () => ({
  default: (await import('./messages-chart')).MessagesChart,
}))

export function AnalyticsView({ overview }: { overview: AnalyticsOverview }) {
  const { start, end } = overview.range
  return (
    <div className="space-y-4">
      <p className="text-ink-muted text-sm">
        {formatShortDate(start)} to {formatShortDate(end)} (UTC days)
      </p>
      <MetricGrid overview={overview} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<Skeleton className="h-80 lg:col-span-2" />}>
          <MessagesChart points={overview.daily} />
        </Suspense>
        <ConversationStates counts={overview.conversations.by_state} />
      </div>
    </div>
  )
}
