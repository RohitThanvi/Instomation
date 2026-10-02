import { isNotYetAvailable } from '@/api/unavailable'
import { can } from '@/auth/permissions'
import { useRequiredOrganization } from '@/auth/session-context'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { NotYetAvailable } from '@/components/ui/not-yet-available'
import { Skeleton } from '@/components/ui/skeleton'
import { AnalyticsView } from './analytics-view'
import { useDashboardOverview } from './use-dashboard'

export function AnalyticsSection() {
  const { role } = useRequiredOrganization()
  const allowed = can(role, 'analytics_view')
  const overview = useDashboardOverview(allowed)

  if (!allowed) {
    return (
      <Notice tone="info" title="Analytics are for owners, admins and managers">
        Your role focuses on the conversations assigned to you. Ask an owner or admin if you need
        access to performance numbers.
      </Notice>
    )
  }
  if (overview.isPending) return <Skeleton className="h-64 w-full" />
  if (overview.isError) {
    if (isNotYetAvailable(overview.error)) {
      return (
        <NotYetAvailable feature="Analytics">
          <p>
            Message volume, conversations, leads and how much the assistant handles on its own will
            appear here once the analytics service is live.
          </p>
          <p>Nothing is estimated or sampled in the meantime.</p>
        </NotYetAvailable>
      )
    }
    return (
      <ErrorState
        error={overview.error}
        title="We could not load your analytics"
        onRetry={() => void overview.refetch()}
      />
    )
  }
  return <AnalyticsView overview={overview.data} />
}
