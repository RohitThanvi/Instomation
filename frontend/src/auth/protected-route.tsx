import { useAuth } from '@clerk/clerk-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/config/constants'

export function ProtectedRoute() {
  const { isLoaded, isSignedIn } = useAuth()
  const location = useLocation()

  if (!isLoaded) {
    return (
      <div
        role="status"
        aria-label="Loading your session"
        className="grid min-h-dvh place-items-center"
      >
        <Skeleton className="h-6 w-40" />
      </div>
    )
  }
  if (!isSignedIn) {
    const redirectTo = `${location.pathname}${location.search}`
    return (
      <Navigate to={`${ROUTES.signIn}?redirect_url=${encodeURIComponent(redirectTo)}`} replace />
    )
  }
  return <Outlet />
}
