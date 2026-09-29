import { useId, type ComponentProps, type ReactNode } from 'react'
import { Input } from './input'
import { Textarea } from './textarea'

interface FieldChrome {
  label: string
  hint?: string | undefined
  error?: string | undefined
}

function FieldFrame({
  id,
  label,
  hint,
  error,
  children,
}: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-ink-subtle text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-danger-600 text-sm">
          {error}
        </p>
      )}
    </div>
  )
}

function describedBy(
  id: string,
  hint: string | undefined,
  error: string | undefined,
): string | undefined {
  if (error) return `${id}-error`
  return hint ? `${id}-hint` : undefined
}

export function TextField({ label, hint, error, ...props }: FieldChrome & ComponentProps<'input'>) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </FieldFrame>
  )
}

export function TextAreaField({
  label,
  hint,
  error,
  ...props
}: FieldChrome & ComponentProps<'textarea'>) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </FieldFrame>
  )
}
