import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="border-line-strong bg-surface flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="text-ink font-medium">{title}</p>
      <p className="text-ink-muted max-w-sm text-sm">{description}</p>
      {action}
    </div>
  )
}
