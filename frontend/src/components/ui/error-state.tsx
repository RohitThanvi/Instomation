import { AlertCircle } from 'lucide-react'
import { errorMessage } from '@/api/errors'
import { Button } from './button'

interface ErrorStateProps {
  error: unknown
  title?: string
  onRetry?: () => void
}

export function ErrorState({ error, title = 'We could not load this', onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="border-line bg-surface shadow-card flex flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center"
    >
      <span className="bg-danger-50 text-danger-600 grid size-10 place-items-center rounded-full">
        <AlertCircle className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-ink font-medium">{title}</p>
        <p className="text-ink-muted max-w-md text-sm">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
