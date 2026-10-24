import { useId } from 'react'

interface RangeFieldProps {
  label: string
  /** Shown at the left and right end of the track, for example "Precise" and "Creative". */
  lowLabel: string
  highLabel: string
  hint: string
  value: number
  onChange: (value: number) => void
  /** How the current value reads aloud and on screen, for example "70%". */
  format: (value: number) => string
  min?: number
  max?: number
  step?: number
}

export function RangeField({
  label,
  lowLabel,
  highLabel,
  hint,
  value,
  onChange,
  format,
  min = 0,
  max = 100,
  step = 5,
}: RangeFieldProps) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-ink text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="text-ink text-sm font-medium tabular-nums">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          onChange(Number(event.target.value))
        }}
        className="accent-accent-600 h-2 w-full cursor-pointer"
      />
      <div className="text-ink-subtle flex justify-between text-xs">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
      <p id={`${id}-hint`} className="text-ink-subtle text-sm">
        {hint}
      </p>
    </div>
  )
}
