import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { DashboardRange } from '@/api/analytics'
import { tenantKey } from '@/api/keys'
import { fetchUsage } from '@/api/usage'
import { useRequiredOrganization, useSession } from '@/auth/session-context'

export function useUsage(range: DashboardRange, enabled: boolean) {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useQuery({
    queryKey: tenantKey(organization.id, 'usage', range),
    queryFn: ({ signal }) => fetchUsage(client, range, signal),
    enabled,
    // Keep the previous period on screen while the next one loads, so switching never flashes.
    placeholderData: keepPreviousData,
  })
}
