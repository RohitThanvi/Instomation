import { useState, type SyntheticEvent } from 'react'
import { KNOWLEDGE_KINDS, KNOWLEDGE_LIMITS } from '@/api/knowledge'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/select-field'
import { TextAreaField, TextField } from '@/components/ui/text-field'
import { validateEntry, type EntryFormErrors, type EntryFormValues } from './entry-schema'
import { KIND_LABELS } from './labels'

interface EntryFormProps {
  initial: EntryFormValues
  submitLabel: string
  pending: boolean
  onSubmit: (values: EntryFormValues) => void
  onCancel: () => void
}

export function EntryForm({ initial, submitLabel, pending, onSubmit, onCancel }: EntryFormProps) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<EntryFormErrors>({})

  function submit(event: SyntheticEvent) {
    event.preventDefault()
    const result = validateEntry(values)
    if (result.ok) {
      setErrors({})
      onSubmit(result.values)
    } else {
      setErrors(result.errors)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <SelectField
        label="Type"
        value={values.kind}
        onChange={(event) => {
          setValues({
            ...values,
            kind: KNOWLEDGE_KINDS.find((kind) => kind === event.target.value) ?? values.kind,
          })
        }}
      >
        {KNOWLEDGE_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {KIND_LABELS[kind]}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Title"
        value={values.title}
        error={errors.title}
        onChange={(event) => {
          setValues({ ...values, title: event.target.value })
        }}
      />
      <TextAreaField
        label="What the assistant should know"
        rows={5}
        value={values.content}
        error={errors.content}
        hint={`${String(values.content.length)} / ${String(KNOWLEDGE_LIMITS.content)}`}
        onChange={(event) => {
          setValues({ ...values, content: event.target.value })
        }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
