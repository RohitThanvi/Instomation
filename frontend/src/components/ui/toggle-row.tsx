import type { UseFormRegisterReturn } from 'react-hook-form'

interface ToggleRowProps {
  label: string
  description: string
  registration: UseFormRegisterReturn
}

export function ToggleRow({ label, description, registration }: ToggleRowProps) {
  return (
    <label className="border-line bg-surface shadow-card has-[:focus-visible]:outline-accent-600 flex cursor-pointer items-start justify-between gap-6 rounded-lg border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
      <span className="space-y-0.5">
        <span className="text-ink block text-sm font-medium">{label}</span>
        <span className="text-ink-muted block text-sm">{description}</span>
      </span>
      <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center">
        <input type="checkbox" role="switch" className="peer sr-only" {...registration} />
        <span
          aria-hidden
          className="bg-line-strong peer-checked:bg-accent-600 absolute inset-0 rounded-full transition-colors"
        />
        <span
          aria-hidden
          className="bg-surface shadow-card absolute left-0.5 size-5 rounded-full transition-transform peer-checked:translate-x-5"
        />
      </span>
    </label>
  )
}
