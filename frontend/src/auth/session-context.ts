import { createContext, useContext } from 'react'
import type { ApiClient } from '@/api/client'
import type { Organization } from '@/api/organizations'

export interface SessionValue {
  client: ApiClient
  organizations: Organization[]
  currentOrganization: Organization | null
  organizationsStatus: 'pending' | 'error' | 'success'
  organizationsError: unknown
  refetchOrganizations: () => void
  selectOrganization: (id: string) => void
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (value === null) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}

/** For routes wrapped in <RequireOrganization>, where a current organization is guaranteed. */
export function useRequiredOrganization(): Organization {
  const { currentOrganization } = useSession()
  if (currentOrganization === null)
    throw new Error('useRequiredOrganization used without an organization')
  return currentOrganization
}
