import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_TAG_LENGTH, MAX_TAGS } from '@/config/constants'
import { isDuplicateTag, tagFormSchema, type TagForm } from './tag-form'

interface TagEditorProps {
  tags: readonly string[]
  busy: boolean
  onChange: (tags: string[]) => void
}

export function TagEditor({ tags, busy, onChange }: TagEditorProps) {
  const form = useForm<TagForm>({
    resolver: zodResolver(tagFormSchema),
    defaultValues: { tag: '' },
  })
  const error = form.formState.errors.tag?.message

  const add = form.handleSubmit(({ tag }) => {
    if (isDuplicateTag(tags, tag)) {
      form.setError('tag', { message: 'That tag is already added.' })
      return
    }
    onChange([...tags, tag])
    form.reset({ tag: '' })
  })

  return (
    <div className="space-y-3">
      {tags.length > 0 && (
        <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="bg-sunken text-ink inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                disabled={busy}
                onClick={() => {
                  onChange(tags.filter((candidate) => candidate !== tag))
                }}
                className="text-ink-subtle hover:bg-line hover:text-ink grid size-5 place-items-center rounded-full disabled:opacity-50"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {tags.length >= MAX_TAGS ? (
        <p className="text-ink-muted text-sm">You have reached the limit of {MAX_TAGS} tags.</p>
      ) : (
        <form onSubmit={(event) => void add(event)} noValidate className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              {...form.register('tag')}
              aria-label="New tag"
              placeholder="Add a tag"
              maxLength={MAX_TAG_LENGTH}
              aria-invalid={error ? true : undefined}
              className="h-9"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={busy} className="h-9">
              Add
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-danger-600 text-sm">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
