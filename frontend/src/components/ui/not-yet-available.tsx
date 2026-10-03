import { Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from './badge'

interface NotYetAvailableProps {
  feature: string
  children?: ReactNode
  actions?: ReactNode
}

/** The honest empty state for features whose backend endpoint has not shipped. */
export function NotYetAvailable({ feature, children, actions }: NotYetAvailableProps) {
  return (
    <div
      role="status"
      className="border-line bg-surface shadow-card flex flex-col items-start gap-4 rounded-lg border p-6"
    >
      <span className="bg-info-50 text-info-600 grid size-10 place-items-center rounded-full">
        <Clock className="size-5" aria-hidden />
      </span>
      <div className="space-y-2">
        <Badge tone="info">Not yet available</Badge>
        <p className="font-display text-ink text-lg font-medium tracking-tight">
          {feature} isn&rsquo;t available yet
        </p>
        {children && <div className="text-ink-muted space-y-2 text-sm">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
