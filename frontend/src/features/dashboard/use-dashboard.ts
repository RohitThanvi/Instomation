import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchAnalyticsOverview, type DashboardRange } from '@/api/analytics'
import { tenantKey } from '@/api/keys'
import { useRequiredOrganization, useSession } from '@/auth/session-context'

export function useAnalyticsOverview(range: DashboardRange, enabled: boolean) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useQuery({
    queryKey: tenantKey(organization.id, 'analytics', 'overview', range),
    queryFn: ({ signal }) => fetchAnalyticsOverview(client, range, signal),
    enabled,
    // Keep the previous period on screen while the next one loads, so switching never flashes.
    placeholderData: keepPreviousData,
  })
}
