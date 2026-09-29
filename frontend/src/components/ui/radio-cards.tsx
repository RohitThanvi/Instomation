import type { UseFormRegisterReturn } from 'react-hook-form'
import { cn } from '@/lib/cn'

export interface RadioCardOption {
  value: string
  label: string
  description: string
}

interface RadioCardsProps {
  legend: string
  registration: UseFormRegisterReturn
  options: readonly RadioCardOption[]
  error?: string | undefined
}

export function RadioCards({ legend, registration, options, error }: RadioCardsProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-ink text-sm font-medium">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'border-line-strong bg-surface shadow-card relative flex cursor-pointer flex-col gap-1 rounded-lg border p-4 transition-colors',
              'hover:border-ink-subtle has-[:checked]:border-accent-600 has-[:checked]:bg-accent-50 has-[:focus-visible]:outline-accent-600 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
            )}
          >
            <input type="radio" value={option.value} className="sr-only" {...registration} />
            <span className="text-ink text-sm font-medium">{option.label}</span>
            <span className="text-ink-muted text-sm">{option.description}</span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-danger-600 text-sm">
          {error}
        </p>
      )}
    </fieldset>
  )
}
