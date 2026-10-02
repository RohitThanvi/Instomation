import { useRequiredOrganization } from '@/auth/session-context'
import { AnalyticsSection } from './analytics-section'
import { ConnectionAttention } from './connection-attention'
import { ConnectionCard } from './connection-card'
import { SupportedActionsCard } from './supported-actions-card'

export function DashboardPage() {
  const organization = useRequiredOrganization()
  return (
    <div className="animate-fade-in space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-medium tracking-tight">Overview</h1>
        <p className="text-ink-muted">{organization.name}</p>
      </header>

      <ConnectionAttention />

      <section aria-labelledby="connection-heading" className="space-y-4">
        <h2 id="connection-heading" className="sr-only">
          Instagram
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ConnectionCard />
          <SupportedActionsCard />
        </div>
      </section>

      <section aria-labelledby="performance-heading" className="space-y-4">
        <h2 id="performance-heading" className="font-display text-xl font-medium tracking-tight">
          Performance
        </h2>
        <AnalyticsSection />
      </section>
    </div>
  )
}
