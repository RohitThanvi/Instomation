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
import { AnalyticsView } from './analytics-view'
import { RANGE_LABELS } from './range-labels'
import { useAnalyticsOverview } from './use-dashboard'

export function AnalyticsSection() {
  const { role } = useRequiredOrganization()
  const allowed = can(role, 'analytics_view')
  const [range, setRange] = useState<DashboardRange>(DEFAULT_DASHBOARD_RANGE)
  const overview = useAnalyticsOverview(range, allowed)

  if (!allowed) {
    return (
      <Notice tone="info" title="Analytics are for owners, admins and managers">
        Your role focuses on the conversations assigned to you. Ask an owner or admin if you need
        access to performance numbers.
      </Notice>
    )
  }
  return (
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
      {overview.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : overview.isError ? (
        <ErrorState
          error={overview.error}
          title="We could not load your analytics"
          onRetry={() => void overview.refetch()}
        />
      ) : (
        <AnalyticsView overview={overview.data} />
      )}
    </div>
  )
}
