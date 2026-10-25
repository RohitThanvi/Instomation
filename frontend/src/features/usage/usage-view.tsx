import { lazy, Suspense } from 'react'
import type { UsageReport } from '@/api/usage'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Notice } from '@/components/ui/notice'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCount, formatShortDate, formatUsd } from '@/lib/format'
import { purposeLabel } from './labels'
import { UsageTable } from './usage-table'

// Recharts is the heaviest dependency here; only load it once there is data to draw.
const RequestsChart = lazy(async () => ({
  default: (await import('./requests-chart')).RequestsChart,
}))

export function UsageView({ report }: { report: UsageReport }) {
  const { start, end } = report.range
  const { totals } = report
  const metrics = [
    {
      label: 'Estimated cost',
      value: formatUsd(totals.estimated_cost),
      note: 'An estimate, not an invoice',
    },
    {
      label: 'AI requests',
      value: formatCount(totals.requests),
      note:
        report.failed_requests > 0 ? `${formatCount(report.failed_requests)} failed` : undefined,
    },
    {
      label: 'Tokens used',
      value: formatCount(totals.input_tokens + totals.output_tokens),
      note: `${formatCount(totals.input_tokens)} in, ${formatCount(totals.output_tokens)} out`,
    },
    {
      label: 'Average response time',
      value:
        report.average_latency_ms === null ? '—' : `${formatCount(report.average_latency_ms)} ms`,
      note: undefined,
    },
  ]
  return (
    <div className="space-y-4">
      <p className="text-ink-muted text-sm">
        {formatShortDate(start)} to {formatShortDate(end)} (UTC days)
      </p>
      {report.unpriced_requests > 0 && (
        <Notice tone="warning" title="The cost shown is lower than your real spend">
          {formatCount(report.unpriced_requests)} request
          {report.unpriced_requests === 1 ? ' used' : 's used'} a model that has no price on file,
          so it is not in the estimated cost. Token counts are exact.
        </Notice>
      )}
      {totals.requests === 0 ? (
        <EmptyState
          title="No AI usage in this period"
          description="Once the assistant answers a message or checks a comment, its requests and estimated cost appear here."
        />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map(({ label, value, note }) => (
              <Card key={label} className="p-5">
                <dt className="text-ink-muted text-sm">{label}</dt>
                <dd className="font-display text-ink mt-2 text-3xl font-medium tracking-tight">
                  {value}
                </dd>
                {note !== undefined && <p className="text-ink-subtle mt-1 text-xs">{note}</p>}
              </Card>
            ))}
          </dl>
          <Suspense fallback={<Skeleton className="h-72 w-full" />}>
            <RequestsChart points={report.daily} />
          </Suspense>
          <div className="grid gap-4 lg:grid-cols-2">
            <UsageTable
              title="By purpose"
              firstColumn="Purpose"
              rows={report.by_purpose.map((row) => ({
                key: row.purpose,
                label: purposeLabel(row.purpose),
                line: row,
              }))}
            />
            <UsageTable
              title="By model"
              firstColumn="Model"
              rows={report.by_model.map((row) => ({
                key: `${row.provider}/${row.model}`,
                label: row.model,
                detail: row.provider,
                line: row,
              }))}
            />
          </div>
        </>
      )}
    </div>
  )
}
