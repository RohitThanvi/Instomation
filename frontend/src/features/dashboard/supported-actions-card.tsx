import { Check } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { FEATURE_COPY, SUPPORTED_FEATURES } from '@/features/instagram/feature-copy'
import { useCapabilities } from '@/features/instagram/use-instagram'

/** Lists only what the server confirms is enabled; nothing else is mentioned. */
export function SupportedActionsCard() {
  const capabilities = useCapabilities()

  if (capabilities.isPending) return <Skeleton className="h-40 w-full" />
  if (capabilities.isError) {
    return (
      <ErrorState
        error={capabilities.error}
        title="We could not load what is supported"
        onRetry={capabilities.refetch}
      />
    )
  }

  const enabled = SUPPORTED_FEATURES.filter((feature) => capabilities.isEnabled(feature))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Supported on your connection</CardTitle>
        <CardDescription>
          What Instomation can do on Instagram for this workspace, as confirmed by the server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {enabled.length === 0 ? (
          <p className="text-ink-muted text-sm">No actions are available right now.</p>
        ) : (
          <ul className="space-y-3">
            {enabled.map((feature) => (
              <li key={feature} className="flex gap-3">
                <Check className="text-success-600 mt-0.5 size-4 shrink-0" aria-hidden />
                <div>
                  <p className="text-ink text-sm font-medium">{FEATURE_COPY[feature].label}</p>
                  <p className="text-ink-muted text-sm">{FEATURE_COPY[feature].description}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
