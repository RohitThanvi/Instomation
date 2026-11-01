import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Rule } from '@/api/automations'
import { errorMessage } from '@/api/errors'
import { can } from '@/auth/permissions'
import { useRequiredOrganization } from '@/auth/session-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { Skeleton } from '@/components/ui/skeleton'
import { UnsavedChangesGuard } from '@/features/settings/unsaved-changes'
import { PreviewPanel } from './preview-panel'
import { RuleCard } from './rule-card'
import { RuleEditor } from './rule-editor'
import { emptyRuleForm, ruleToForm } from './rule-form'
import {
  useDeleteRule,
  useReorderRules,
  useRules,
  useSaveRule,
  useToggleRule,
} from './use-automations'

type Editing = { kind: 'new' } | { kind: 'edit'; rule: Rule }

export function AutomationsPage() {
  const { role } = useRequiredOrganization()
  const allowed = can(role, 'automation_manage')
  const rules = useRules(allowed)
  const save = useSaveRule()
  const remove = useDeleteRule()
  const toggle = useToggleRule()
  const reorder = useReorderRules()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [dirty, setDirty] = useState(false)
  const reportDirty = useCallback((value: boolean) => {
    setDirty(value)
  }, [])

  const busy = remove.isPending || toggle.isPending || reorder.isPending
  const actionError = remove.error ?? toggle.error ?? reorder.error
  const list = rules.data ?? []

  const move = (index: number, direction: -1 | 1) => {
    const ids = list.map((rule) => rule.id)
    const [moved] = ids.splice(index, 1)
    if (moved === undefined) return
    ids.splice(index + direction, 0, moved)
    reorder.mutate(ids)
  }
  const close = () => {
    save.reset()
    setEditing(null)
  }
  const editor =
    editing === null ? null : (
      <RuleEditor
        key={editing.kind === 'new' ? 'new' : editing.rule.id}
        title={editing.kind === 'new' ? 'New rule' : 'Edit rule'}
        initial={editing.kind === 'new' ? emptyRuleForm() : ruleToForm(editing.rule)}
        saving={save.isPending}
        error={save.error}
        onDirtyChange={reportDirty}
        onCancel={close}
        onSave={(rule) => {
          save.mutate(
            { id: editing.kind === 'new' ? null : editing.rule.id, rule },
            { onSuccess: close },
          )
        }}
      />
    )

  return (
    <div className="animate-fade-in max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-medium tracking-tight">Automation rules</h1>
        <p className="text-ink-muted max-w-xl">
          A rule answers a message with a reply you wrote, or hands it to a person, instead of
          leaving it to the assistant. Rules are tried from the top; the first one that matches
          decides. If none match, the assistant answers as usual.
        </p>
      </div>
      {!allowed ? (
        <Notice tone="info" title="Automation rules are for owners, admins and managers">
          Ask one of them if a message should always get the same answer.
        </Notice>
      ) : (
        <>
          <UnsavedChangesGuard dirty={dirty} />
          {rules.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : rules.isError ? (
            <ErrorState
              error={rules.error}
              title="We could not load your rules"
              onRetry={() => void rules.refetch()}
            />
          ) : (
            <>
              {actionError !== null && (
                <Notice tone="danger" title="That did not work">
                  {errorMessage(actionError)}
                </Notice>
              )}
              {editing?.kind === 'new' && editor}
              {list.length === 0 && editing === null ? (
                <EmptyState
                  title="No rules yet"
                  description="Add a rule when a kind of message should always get the same answer, for example your opening hours or a delivery question."
                />
              ) : (
                <ol className="space-y-3" aria-label="Rules, in the order they are tried">
                  {list.map((rule, index) =>
                    editing?.kind === 'edit' && editing.rule.id === rule.id ? (
                      <li key={rule.id}>{editor}</li>
                    ) : (
                      <RuleCard
                        key={rule.id}
                        rule={rule}
                        position={index + 1}
                        count={list.length}
                        busy={busy}
                        onMove={(direction) => {
                          move(index, direction)
                        }}
                        onToggle={() => {
                          toggle.mutate(rule)
                        }}
                        onEdit={() => {
                          save.reset()
                          setEditing({ kind: 'edit', rule })
                        }}
                        onDelete={() => {
                          remove.mutate(rule.id)
                        }}
                      />
                    ),
                  )}
                </ol>
              )}
              {editing === null && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    save.reset()
                    setEditing({ kind: 'new' })
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  Add a rule
                </Button>
              )}
              <PreviewPanel />
            </>
          )}
        </>
      )}
    </div>
  )
}
