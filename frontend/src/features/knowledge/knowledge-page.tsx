import { useState } from 'react'
import { KNOWLEDGE_KINDS, knowledgeKindSchema, type KnowledgeKind } from '@/api/knowledge'
import { can } from '@/auth/permissions'
import { useRequiredOrganization } from '@/auth/session-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { EntryCard } from './entry-card'
import { EntryForm } from './entry-form'
import { EMPTY_ENTRY } from './entry-schema'
import { KIND_LABELS } from './labels'
import { SearchPanel } from './search-panel'
import { useKnowledgeList, useKnowledgeMutations } from './use-knowledge'

export function KnowledgePage() {
  const { role } = useRequiredOrganization()
  return (
    <div className="animate-fade-in space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-medium tracking-tight">Knowledge base</h1>
        <p className="text-ink-muted max-w-xl">
          What your assistant knows about your business. It answers from these entries, and hands
          the conversation to you when they do not cover the question.
        </p>
      </div>
      {can(role, 'settings_manage') ? (
        <KnowledgeManager />
      ) : (
        <Notice tone="info" title="The knowledge base is for owners and admins">
          Ask an owner or admin if something the assistant says needs correcting.
        </Notice>
      )}
    </div>
  )
}

function KnowledgeManager() {
  const [kind, setKind] = useState<KnowledgeKind | null>(null)
  const [adding, setAdding] = useState(false)
  const list = useKnowledgeList(kind)
  const { create } = useKnowledgeMutations()
  const entries = list.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-48">
            <SelectField
              label="Show"
              value={kind ?? 'all'}
              onChange={(event) => {
                const parsed = knowledgeKindSchema.safeParse(event.target.value)
                setKind(parsed.success ? parsed.data : null)
              }}
            >
              <option value="all">Everything</option>
              {KNOWLEDGE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </SelectField>
          </div>
          {!adding && (
            <Button
              onClick={() => {
                setAdding(true)
              }}
            >
              Add entry
            </Button>
          )}
        </div>

        {adding && (
          <Card className="p-5">
            <EntryForm
              initial={{ ...EMPTY_ENTRY, kind: kind ?? EMPTY_ENTRY.kind }}
              submitLabel="Add entry"
              pending={create.isPending}
              onCancel={() => {
                setAdding(false)
              }}
              onSubmit={(values) => {
                create.mutate(values, {
                  onSuccess: () => {
                    setAdding(false)
                  },
                })
              }}
            />
          </Card>
        )}

        {list.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : list.isError ? (
          <ErrorState
            error={list.error}
            title="We could not load your knowledge base"
            onRetry={() => void list.refetch()}
          />
        ) : entries.length === 0 ? (
          <EmptyState
            title={kind === null ? 'Nothing here yet' : `No ${KIND_LABELS[kind]} entries`}
            description="Add the questions customers ask, your products, services and policies. The assistant only answers from what is here."
          />
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.id}>
                <EntryCard entry={entry} />
              </li>
            ))}
          </ul>
        )}

        {list.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
      <SearchPanel />
    </div>
  )
}
