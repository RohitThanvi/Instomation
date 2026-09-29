import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const TONES = {
  success: {
    box: 'border-success-600/25 bg-success-50',
    icon: CheckCircle2,
    iconClass: 'text-success-600',
    role: 'status',
  },
  warning: {
    box: 'border-warning-600/25 bg-warning-50',
    icon: AlertCircle,
    iconClass: 'text-warning-600',
    role: 'alert',
  },
  danger: {
    box: 'border-danger-600/25 bg-danger-50',
    icon: AlertCircle,
    iconClass: 'text-danger-600',
    role: 'alert',
  },
  info: {
    box: 'border-info-600/25 bg-info-50',
    icon: Info,
    iconClass: 'text-info-600',
    role: 'status',
  },
} as const

interface NoticeProps {
  tone: keyof typeof TONES
  title: string
  children?: ReactNode
  actions?: ReactNode
}

export function Notice({ tone, title, children, actions }: NoticeProps) {
  const { box, icon: Icon, iconClass, role } = TONES[tone]
  return (
    <div role={role} className={cn('flex gap-3 rounded-lg border p-4', box)}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', iconClass)} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-ink text-sm font-medium">{title}</p>
        {children && <div className="text-ink-muted text-sm">{children}</div>}
        {actions && <div className="flex flex-wrap gap-2 pt-2">{actions}</div>}
      </div>
    </div>
  )
}
