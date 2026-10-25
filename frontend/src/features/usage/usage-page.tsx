import { useState } from 'react'
import {
  dashboardRangeSchema,
  DASHBOARD_RANGES,
  DEFAULT_DASHBOARD_RANGE,
  type DashboardRange,
} from '@/api/analytics'
import { can } from '@/auth/permissions'
import { useRequiredOrganization } from '@/auth/session-context'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { RANGE_LABELS } from '@/features/dashboard/range-labels'
import { UsageView } from './usage-view'
import { useUsage } from './use-usage'

export function UsagePage() {
  const { role } = useRequiredOrganization()
  const allowed = can(role, 'settings_manage')
  const [range, setRange] = useState<DashboardRange>(DEFAULT_DASHBOARD_RANGE)
  const usage = useUsage(range, allowed)

  return (
    <div className="animate-fade-in space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-medium tracking-tight">Usage</h1>
        <p className="text-ink-muted max-w-xl">
          What the assistant&apos;s AI requests add up to. Costs are estimates from a built-in price
          table, so your AI provider&apos;s own bill is the final word.
        </p>
      </div>
      {!allowed ? (
        <Notice tone="info" title="Usage is for owners and admins">
          Ask an owner or admin if you need to see what the assistant costs.
        </Notice>
      ) : (
        <div className="space-y-4">
          <div className="max-w-48">
            <SelectField
              label="Period"
              value={range}
              onChange={(event) => {
                setRange(dashboardRangeSchema.parse(event.target.value))
              }}
            >
              {DASHBOARD_RANGES.map((value) => (
                <option key={value} value={value}>
                  {RANGE_LABELS[value]}
                </option>
              ))}
            </SelectField>
          </div>
          {usage.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : usage.isError ? (
            <ErrorState
              error={usage.error}
              title="We could not load your usage"
              onRetry={() => void usage.refetch()}
            />
          ) : (
            <UsageView report={usage.data} />
          )}
        </div>
      )}
    </div>
  )
}
