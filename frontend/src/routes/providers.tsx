import { ClerkProvider } from '@clerk/clerk-react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { errorMessage } from '@/api/errors'
import { isNotYetAvailable } from '@/api/unavailable'
import { SessionProvider } from '@/auth/session'
import { ErrorBoundary } from '@/components/error-boundary'
import { ToastProvider } from '@/components/ui/toast'
import { useToast } from '@/components/ui/toast-context'
import type { Env } from '@/config/env'
import { ROUTES } from '@/config/constants'
import { createQueryClient } from '@/lib/query-client'

function QueryLayer({ apiBaseUrl }: { apiBaseUrl: string }) {
  const toast = useToast()
  const [queryClient] = useState(() =>
    createQueryClient((error) => {
      // Screens render an explicit "not yet available" state for these; a toast would be noise.
      if (isNotYetAvailable(error)) return
      toast({ title: 'That did not work', description: errorMessage(error), variant: 'error' })
    }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider apiBaseUrl={apiBaseUrl}>
        <Outlet />
      </SessionProvider>
    </QueryClientProvider>
  )
}

export function RootProviders({ env }: { env: Env }) {
  const navigate = useNavigate()
  return (
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={env.clerkPublishableKey}
        signInUrl={ROUTES.signIn}
        signUpUrl={ROUTES.signUp}
        signInFallbackRedirectUrl={ROUTES.home}
        signUpFallbackRedirectUrl={ROUTES.home}
        routerPush={(to) => void navigate(to)}
        routerReplace={(to) => void navigate(to, { replace: true })}
      >
        <ToastProvider>
          <QueryLayer apiBaseUrl={env.apiBaseUrl} />
        </ToastProvider>
      </ClerkProvider>
    </ErrorBoundary>
  )
}
