import type { UseFormRegisterReturn } from 'react-hook-form'

interface ToggleRowBase {
  label: string
  description: string
}

/** Either wired into react-hook-form, or controlled by its caller. */
type ToggleRowProps = ToggleRowBase &
  (
    | { registration: UseFormRegisterReturn; checked?: never; onCheckedChange?: never }
    | {
        registration?: never
        checked: boolean
        onCheckedChange: (checked: boolean) => void
      }
  )

export function ToggleRow(props: ToggleRowProps) {
  const { label, description } = props
  const inputProps: React.ComponentProps<'input'> =
    props.registration === undefined
      ? {
          checked: props.checked,
          onChange: (event) => {
            props.onCheckedChange(event.target.checked)
          },
        }
      : props.registration
  return (
    <label className="border-line bg-surface shadow-card has-[:focus-visible]:outline-accent-600 flex cursor-pointer items-start justify-between gap-6 rounded-lg border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
      <span className="space-y-0.5">
        <span className="text-ink block text-sm font-medium">{label}</span>
        <span className="text-ink-muted block text-sm">{description}</span>
      </span>
      <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center">
        <input type="checkbox" role="switch" className="peer sr-only" {...inputProps} />
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
