import { Badge, type BadgeTone } from './badge'
import { cn } from '@/lib/cn'

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-subtle',
  success: 'bg-success-600',
  warning: 'bg-warning-600',
  danger: 'bg-danger-600',
  info: 'bg-info-600',
}

/** Status is always conveyed by text as well as color. */
export function StatusIndicator({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <Badge tone={tone}>
      <span aria-hidden className={cn('size-1.5 rounded-full', DOT_CLASSES[tone])} />
      {label}
    </Badge>
  )
}
