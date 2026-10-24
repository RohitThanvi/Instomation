import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PairRow } from './profile-form'

interface PairEditorProps {
  title: string
  description: string
  /** Singular noun for one row, used in accessible names: "Contact detail", "Policy". */
  itemLabel: string
  addLabel: string
  namePlaceholder: string
  valuePlaceholder: string
  maxItems: number
  rows: readonly PairRow[]
  onChange: (rows: PairRow[]) => void
  rowErrors: Record<number, string>
  listError: string | undefined
}

export function PairEditor({
  title,
  description,
  itemLabel,
  addLabel,
  namePlaceholder,
  valuePlaceholder,
  maxItems,
  rows,
  onChange,
  rowErrors,
  listError,
}: PairEditorProps) {
  const update = (index: number, change: Partial<PairRow>) => {
    onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)))
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-ink text-sm font-medium">{title}</legend>
      <p className="text-ink-subtle text-sm">{description}</p>
      <ul className="space-y-3">
        {rows.map((row, index) => {
          const number = index + 1
          const error = rowErrors[index]
          return (
            <li key={index} className="space-y-1.5">
              <div className="flex items-start gap-2">
                <Input
                  aria-label={`${itemLabel} ${String(number)} name`}
                  aria-invalid={error ? true : undefined}
                  placeholder={namePlaceholder}
                  value={row.key}
                  onChange={(event) => {
                    update(index, { key: event.target.value })
                  }}
                  className="w-1/3"
                />
                <Input
                  aria-label={`${itemLabel} ${String(number)} value`}
                  aria-invalid={error ? true : undefined}
                  placeholder={valuePlaceholder}
                  value={row.value}
                  onChange={(event) => {
                    update(index, { value: event.target.value })
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${itemLabel.toLowerCase()} ${String(number)}`}
                  onClick={() => {
                    onChange(rows.filter((_, at) => at !== index))
                  }}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-danger-600 text-sm">
                  {error}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      {listError && (
        <p role="alert" className="text-danger-600 text-sm">
          {listError}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={rows.length >= maxItems}
        onClick={() => {
          onChange([...rows, { key: '', value: '' }])
        }}
      >
        <Plus className="size-4" aria-hidden />
        {addLabel}
      </Button>
    </fieldset>
  )
}
