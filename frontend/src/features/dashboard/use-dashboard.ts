import { useQuery } from '@tanstack/react-query'
import { DEFAULT_DASHBOARD_RANGE, fetchDashboardOverview } from '@/api/analytics'
import { tenantKey } from '@/api/keys'
import { useRequiredOrganization, useSession } from '@/auth/session-context'

export function useDashboardOverview(enabled: boolean) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useQuery({
    queryKey: tenantKey(organization.id, 'analytics', 'overview', DEFAULT_DASHBOARD_RANGE),
    queryFn: ({ signal }) => fetchDashboardOverview(client, DEFAULT_DASHBOARD_RANGE, signal),
    enabled,
  })
}
