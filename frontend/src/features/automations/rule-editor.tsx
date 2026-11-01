import { useState } from 'react'
import { KEYWORD_MATCHES, RULE_ACTIONS, RULE_SCOPES, type RuleInput } from '@/api/automations'
import { errorMessage } from '@/api/errors'
import type { HandoffReason } from '@/api/handoffs'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { SelectField } from '@/components/ui/select-field'
import { TextAreaField, TextField } from '@/components/ui/text-field'
import { ToggleRow } from '@/components/ui/toggle-row'
import { COMMENT_REPLY_MAX_CHARS, DM_REPLY_MAX_BYTES } from '@/config/constants'
import { REASON_LABELS } from '@/features/handoffs/labels'
import { useReportDirty, type DirtyReporter } from '@/features/settings/use-report-dirty'
import { ACTION_LABELS, MATCH_LABELS, RULE_HANDOFF_REASONS, SCOPE_LABELS } from './labels'
import { validateRuleForm, type RuleErrors, type RuleForm } from './rule-form'

interface RuleEditorProps {
  title: string
  initial: RuleForm
  saving: boolean
  error: unknown
  onSave: (rule: RuleInput) => void
  onCancel: () => void
  onDirtyChange: DirtyReporter
}

export function RuleEditor({
  title,
  initial,
  saving,
  error,
  onSave,
  onCancel,
  onDirtyChange,
}: RuleEditorProps) {
  const [values, setValues] = useState<RuleForm>(initial)
  const [errors, setErrors] = useState<RuleErrors>({})
  const set = (change: Partial<RuleForm>) => {
    setValues((current) => ({ ...current, ...change }))
  }
  useReportDirty(JSON.stringify(values) !== JSON.stringify(initial), onDirtyChange)

  const sendsReply = values.action === 'reply'
  const canMessagePrivately = sendsReply && values.applies_to !== 'dm'
  // A rule may already carry a reason outside the usual list; keep it selectable.
  const reasons: readonly HandoffReason[] =
    values.handoff_reason === '' || RULE_HANDOFF_REASONS.includes(values.handoff_reason)
      ? RULE_HANDOFF_REASONS
      : [...RULE_HANDOFF_REASONS, values.handoff_reason]

  return (
    <form
      aria-label={title}
      className="border-line bg-surface shadow-card space-y-5 rounded-lg border p-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const result = validateRuleForm(values)
        if (!result.ok) {
          setErrors(result.errors)
          return
        }
        setErrors({})
        onSave(result.rule)
      }}
    >
      <h2 className="font-display text-xl font-medium">{title}</h2>

      <TextField
        label="Name"
        hint="Only you see this. It helps you tell your rules apart."
        value={values.name}
        error={errors.name}
        onChange={(event) => {
          set({ name: event.target.value })
        }}
      />

      <SelectField
        label="Applies to"
        value={values.applies_to}
        onChange={(event) => {
          const scope = RULE_SCOPES.find((value) => value === event.target.value)
          if (scope !== undefined) set({ applies_to: scope })
        }}
      >
        {RULE_SCOPES.map((scope) => (
          <option key={scope} value={scope}>
            {SCOPE_LABELS[scope]}
          </option>
        ))}
      </SelectField>

      <div className="space-y-4">
        <TextAreaField
          label="Keywords or phrases"
          rows={4}
          hint="One per line. Capital letters do not matter, and a word also matches inside a longer one (“price” finds “priceless”), so choose specific ones."
          value={values.keywords}
          error={errors.keywords}
          onChange={(event) => {
            set({ keywords: event.target.value })
          }}
        />
        <SelectField
          label="Match a message that contains"
          value={values.keyword_match}
          onChange={(event) => {
            const match = KEYWORD_MATCHES.find((value) => value === event.target.value)
            if (match !== undefined) set({ keyword_match: match })
          }}
        >
          {KEYWORD_MATCHES.map((match) => (
            <option key={match} value={match}>
              {MATCH_LABELS[match]}
            </option>
          ))}
        </SelectField>
      </div>

      <SelectField
        label="Then"
        value={values.action}
        onChange={(event) => {
          const action = RULE_ACTIONS.find((value) => value === event.target.value)
          if (action !== undefined) set({ action })
        }}
      >
        {RULE_ACTIONS.map((action) => (
          <option key={action} value={action}>
            {ACTION_LABELS[action]}
          </option>
        ))}
      </SelectField>

      {sendsReply && (
        <TextAreaField
          label="Reply"
          rows={3}
          hint={
            values.applies_to === 'dm'
              ? `Sent exactly as written. Up to ${String(DM_REPLY_MAX_BYTES)} bytes.`
              : `Sent exactly as written. A comment reply is at most ${String(COMMENT_REPLY_MAX_CHARS)} characters.`
          }
          error={errors.reply_text}
          value={values.reply_text}
          onChange={(event) => {
            set({ reply_text: event.target.value })
          }}
        />
      )}
      {canMessagePrivately && (
        <TextAreaField
          label="Private message (optional)"
          rows={3}
          hint="Sent to the commenter in a direct message after the public reply. It is only sent while “Continue a comment in private” is on in Settings; while it is off, this rule hands the comment to a person instead of sending half of it."
          error={errors.private_reply_text}
          value={values.private_reply_text}
          onChange={(event) => {
            set({ private_reply_text: event.target.value })
          }}
        />
      )}
      {values.action === 'handoff' && (
        <SelectField
          label="Why it goes to a person"
          value={values.handoff_reason}
          aria-invalid={errors.handoff_reason ? true : undefined}
          onChange={(event) => {
            const reason = reasons.find((value) => value === event.target.value)
            set({ handoff_reason: reason ?? '' })
          }}
        >
          <option value="">Choose a reason</option>
          {reasons.map((reason) => (
            <option key={reason} value={reason}>
              {REASON_LABELS[reason]}
            </option>
          ))}
        </SelectField>
      )}
      {errors.handoff_reason && (
        <p role="alert" className="text-danger-600 text-sm">
          {errors.handoff_reason}
        </p>
      )}
      {values.action === 'skip' && (
        <Notice tone="info" title="Nothing is sent">
          Matching messages are left alone: no reply and no hand-over. They stay in the inbox.
        </Notice>
      )}

      <ToggleRow
        label="Turn this rule on"
        description="A paused rule is kept but never used."
        checked={values.enabled}
        onCheckedChange={(enabled) => {
          set({ enabled })
        }}
      />

      {error !== null && error !== undefined && (
        <Notice tone="danger" title="We could not save this rule">
          {errorMessage(error)}
        </Notice>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save rule
        </Button>
      </div>
    </form>
  )
}
