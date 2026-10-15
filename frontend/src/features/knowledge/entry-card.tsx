import { useState } from 'react'
import type { KnowledgeEntry } from '@/api/knowledge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EntryForm } from './entry-form'
import { changedFields } from './entry-schema'
import { KIND_LABELS } from './labels'
import { useKnowledgeMutations } from './use-knowledge'

type Mode = 'view' | 'edit' | 'confirm-delete'

export function EntryCard({ entry }: { entry: KnowledgeEntry }) {
  const [mode, setMode] = useState<Mode>('view')
  const { update, remove } = useKnowledgeMutations()

  if (mode === 'edit') {
    return (
      <Card className="p-5">
        <EntryForm
          initial={{ kind: entry.kind, title: entry.title, content: entry.content }}
          submitLabel="Save changes"
          pending={update.isPending}
          onCancel={() => {
            setMode('view')
          }}
          onSubmit={(values) => {
            const patch = changedFields(entry, values)
            if (Object.keys(patch).length === 0) {
              setMode('view')
              return
            }
            update.mutate(
              { id: entry.id, patch },
              {
                onSuccess: () => {
                  setMode('view')
                },
              },
            )
          }}
        />
      </Card>
    )
  }

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Badge>{KIND_LABELS[entry.kind]}</Badge>
          <h3 className="text-ink font-medium break-words">{entry.title}</h3>
        </div>
        {mode === 'view' && (
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${entry.title}`}
              onClick={() => {
                setMode('edit')
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${entry.title}`}
              onClick={() => {
                setMode('confirm-delete')
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
      <p className="text-ink-muted line-clamp-4 text-sm whitespace-pre-line">{entry.content}</p>
      {mode === 'confirm-delete' && (
        <div
          role="group"
          aria-label={`Confirm deleting ${entry.title}`}
          className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-3"
        >
          <p className="text-ink text-sm">The assistant will stop using this entry.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                setMode('view')
              }}
            >
              Keep it
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(entry.id)
              }}
            >
              Delete entry
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
