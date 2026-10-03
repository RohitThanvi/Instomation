import { ShieldCheck } from 'lucide-react'
import { FEATURE_COPY, SUPPORTED_FEATURES } from './feature-copy'
import { describeAccount } from './account-status'
import { useCapabilities, useConnectInstagram, useInstagramAccounts } from './use-instagram'
import { useRequiredOrganization } from '@/auth/session-context'
import { can } from '@/auth/permissions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusIndicator } from '@/components/ui/status-indicator'

function ConnectedAccounts() {
  const accounts = useInstagramAccounts()
  if (accounts.isPending) return <Skeleton className="h-16 w-full" />
  if (accounts.isError) {
    return (
      <ErrorState
        error={accounts.error}
        title="We could not load your Instagram accounts"
        onRetry={() => void accounts.refetch()}
      />
    )
  }
  if (accounts.data.length === 0) {
    return <p className="text-ink-muted text-sm">No Instagram account is connected yet.</p>
  }
  return (
    <ul className="divide-line border-line divide-y rounded-lg border">
      {accounts.data.map((account) => {
        const view = describeAccount(account)
        return (
          <li key={account.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="space-y-1">
              <p className="text-ink text-sm font-medium">@{account.username}</p>
              <p className="text-ink-muted max-w-md text-sm">{view.detail}</p>
            </div>
            <StatusIndicator tone={view.tone} label={view.label} />
          </li>
        )
      })}
    </ul>
  )
}

/** Only features the server reports as enabled are listed; nothing else is ever advertised. */
function EnabledFeatures() {
  const capabilities = useCapabilities()
  if (capabilities.isPending) return <Skeleton className="h-16 w-full" />
  if (capabilities.isError) {
    return (
      <ErrorState
        error={capabilities.error}
        title="We could not check what the assistant can do"
        onRetry={capabilities.refetch}
      />
    )
  }
  const enabled = SUPPORTED_FEATURES.filter((feature) => capabilities.isEnabled(feature))
  if (enabled.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        No Instagram actions are switched on for this workspace right now.
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {enabled.map((feature) => (
        <li key={feature} className="text-sm">
          <span className="text-ink font-medium">{FEATURE_COPY[feature].label}</span>
          <span className="text-ink-muted"> · {FEATURE_COPY[feature].description}</span>
        </li>
      ))}
    </ul>
  )
}

export function InstagramConnection({
  returnToOnboarding = false,
}: {
  returnToOnboarding?: boolean
}) {
  const organization = useRequiredOrganization()
  const accounts = useInstagramAccounts()
  const connect = useConnectInstagram(returnToOnboarding)
  const canConnect = can(organization.role, 'settings_manage')

  const list = accounts.data ?? []
  const needsReconnect = list.some((account) => describeAccount(account).needsReconnect)
  const buttonLabel = needsReconnect
    ? 'Reconnect Instagram'
    : list.length === 0
      ? 'Connect Instagram'
      : 'Connect another account'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram account</CardTitle>
        <CardDescription>
          Connect a Business or Creator account through Instagram’s official login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ConnectedAccounts />

        <div className="space-y-2">
          <Button
            variant={list.length === 0 || needsReconnect ? 'primary' : 'secondary'}
            loading={connect.isPending}
            disabled={!canConnect}
            onClick={() => {
              connect.mutate()
            }}
          >
            {buttonLabel}
          </Button>
          {!canConnect && (
            <p className="text-ink-subtle text-sm">
              Only owners and admins can connect Instagram accounts.
            </p>
          )}
          <p className="text-ink-subtle flex items-start gap-2 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            You approve access on Instagram. We never see or store your Instagram password.
          </p>
        </div>

        <div className="border-line space-y-2 border-t pt-4">
          <h3 className="text-ink text-sm font-medium">What the assistant can do</h3>
          <EnabledFeatures />
        </div>
      </CardContent>
    </Card>
  )
}
