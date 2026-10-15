import { useState, type SyntheticEvent } from 'react'
import { KNOWLEDGE_LIMITS } from '@/api/knowledge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { KIND_LABELS } from './labels'
import { useKnowledgeSearch } from './use-knowledge'

/** Runs the assistant's own retrieval, so owners can see what it would find for a customer's words. */
export function SearchPanel() {
  const [query, setQuery] = useState('')
  const search = useKnowledgeSearch()

  function submit(event: SyntheticEvent) {
    event.preventDefault()
    const trimmed = query.trim()
    if (trimmed !== '') search.mutate(trimmed)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test what the assistant finds</CardTitle>
        <CardDescription>
          Type what a customer might say. Matching is by whole words, so “ship” will not find
          “shipping”.
        </CardDescription>
      </CardHeader>
      <div className="space-y-4 p-6 pt-3">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            aria-label="What a customer might say"
            value={query}
            maxLength={KNOWLEDGE_LIMITS.query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={search.isPending}
            disabled={query.trim() === ''}
          >
            Search
          </Button>
        </form>
        {search.isSuccess && search.data.length === 0 && (
          <p className="text-ink-muted text-sm">
            Nothing matched. For this text the assistant would find no information from your
            knowledge base.
          </p>
        )}
        {search.isSuccess && search.data.length > 0 && (
          <ol aria-label="Matches, best first" className="space-y-3">
            {search.data.map(({ entry }) => (
              <li key={entry.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge>{KIND_LABELS[entry.kind]}</Badge>
                  <span className="text-ink text-sm font-medium break-words">{entry.title}</span>
                </div>
                <p className="text-ink-muted line-clamp-3 text-sm whitespace-pre-line">
                  {entry.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  )
}
