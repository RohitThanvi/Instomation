import { useAuth } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createApiClient } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { collectPages } from '@/api/pagination'
import { fetchOrganizations } from '@/api/organizations'
import { SessionContext, type SessionValue } from './session-context'
import { STORAGE_KEYS } from '@/config/constants'
import { readStorage, writeStorage } from '@/lib/storage'
import { createTenantHeader } from '@/lib/tenant-header'

export function SessionProvider({
  apiBaseUrl,
  children,
}: {
  apiBaseUrl: string
  children: ReactNode
}) {
  const { getToken, isSignedIn } = useAuth()
  const [storedId, setStoredId] = useState<string | null>(() =>
    readStorage(STORAGE_KEYS.selectedOrganization),
  )
  const [tenantHeader] = useState(createTenantHeader)

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl,
        getToken: () => getToken(),
        getSelectedOrganizationId: tenantHeader.get,
      }),
    [apiBaseUrl, getToken, tenantHeader],
  )

  const query = useQuery({
    queryKey: queryKeys.organizations,
    queryFn: ({ signal }) => collectPages((cursor) => fetchOrganizations(client, cursor, signal)),
    enabled: isSignedIn === true,
  })

  const organizations = useMemo(() => query.data ?? [], [query.data])
  const currentOrganization =
    organizations.length === 0
      ? null
      : (organizations.find((org) => org.id === storedId) ?? organizations[0] ?? null)

  // A user in exactly one organization needs no header; with several, the server
  // requires a selection (which it validates against membership).
  // Layout effect: must be set before any child query effect issues a request.
  useLayoutEffect(() => {
    tenantHeader.set(organizations.length > 1 ? (currentOrganization?.id ?? null) : null)
  }, [organizations.length, currentOrganization?.id, tenantHeader])

  const selectOrganization = useCallback((id: string) => {
    setStoredId(id)
    writeStorage(STORAGE_KEYS.selectedOrganization, id)
  }, [])

  const { refetch } = query
  const value = useMemo<SessionValue>(
    () => ({
      client,
      organizations,
      currentOrganization,
      organizationsStatus: query.status,
      organizationsError: query.error,
      refetchOrganizations: () => void refetch(),
      selectOrganization,
    }),
    [
      client,
      organizations,
      currentOrganization,
      query.status,
      query.error,
      refetch,
      selectOrganization,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
