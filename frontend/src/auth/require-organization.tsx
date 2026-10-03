import { Navigate, Outlet } from 'react-router-dom'
import { useSession } from './session-context'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/config/constants'

/** Sends users without a workspace to onboarding (the server answers ORGANIZATION_REQUIRED for them). */
export function RequireOrganization() {
  const { organizationsStatus, organizationsError, currentOrganization, refetchOrganizations } =
    useSession()

  if (organizationsStatus === 'pending') return <Skeleton className="h-40 w-full" />
  if (organizationsStatus === 'error') {
    return (
      <ErrorState
        error={organizationsError}
        title="We could not load your workspaces"
        onRetry={refetchOrganizations}
      />
    )
  }
  if (currentOrganization === null) return <Navigate to={`${ROUTES.onboarding}/welcome`} replace />
  return <Outlet />
}
