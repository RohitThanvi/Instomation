import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { fetchIdentity } from '@/api/auth'
import { queryKeys } from '@/api/keys'
import { useSession } from '@/auth/session-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'

function SessionCard() {
  const { client } = useSession()
  const identity = useQuery({
    queryKey: queryKeys.identity,
    queryFn: ({ signal }) => fetchIdentity(client, signal),
  })

  if (identity.isPending) return <Skeleton className="h-28 w-full" />
  if (identity.isError) {
    return (
      <ErrorState
        error={identity.error}
        title="We could not verify your session"
        onRetry={() => void identity.refetch()}
      />
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed in</CardTitle>
        <CardDescription>Instomation has verified your session.</CardDescription>
      </CardHeader>
      <CardContent className="text-ink-muted flex items-center gap-2 text-sm">
        <CheckCircle2 className="text-success-600 size-4" aria-hidden />
        Your account is authenticated and ready.
      </CardContent>
    </Card>
  )
}

function WorkspaceCard() {
  const {
    organizations,
    currentOrganization,
    organizationsStatus,
    organizationsError,
    refetchOrganizations,
  } = useSession()

  if (organizationsStatus === 'pending') return <Skeleton className="h-28 w-full" />
  if (organizationsStatus === 'error') {
    return (
      <ErrorState
        error={organizationsError}
        title="We could not load your workspaces"
        onRetry={refetchOrganizations}
      />
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          {currentOrganization === null
            ? 'You do not have a workspace yet. Guided setup is coming next.'
            : `${currentOrganization.name} · ${currentOrganization.role.toLowerCase()}`}
        </CardDescription>
      </CardHeader>
      {organizations.length > 1 && (
        <CardContent className="text-ink-muted text-sm">
          You belong to {organizations.length} workspaces.
        </CardContent>
      )}
    </Card>
  )
}

export function HomePage() {
  return (
    <div className="animate-fade-in space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-medium tracking-tight">Welcome to Instomation</h1>
        <p className="text-ink-muted max-w-xl">
          Your assistant for Instagram comments and messages.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SessionCard />
        <WorkspaceCard />
      </div>
    </div>
  )
}
