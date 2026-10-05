import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FEATURES } from '@/api/instagram'
import type { Conversation } from '@/api/conversations'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { useCapabilities } from '@/features/instagram/use-instagram'
import { draftSchema, type Draft } from './message-draft'
import { composerAvailability } from './labels'
import { useConversationActions } from './use-inbox'

type Mode = 'reply' | 'note'

const MODE_COPY: Record<Mode, { label: string; submit: string; help: string }> = {
  reply: {
    label: 'Reply to customer',
    submit: 'Send reply',
    help: 'Sent to the customer on Instagram.',
  },
  note: {
    label: 'Internal note',
    submit: 'Add note',
    help: 'Only your team can see notes. They are never sent to the customer.',
  },
}

export function Composer({ conversation }: { conversation: Conversation }) {
  const actions = useConversationActions(conversation.id)
  const capabilities = useCapabilities()
  const [mode, setMode] = useState<Mode>('reply')
  const form = useForm<Draft>({
    resolver: zodResolver(draftSchema),
    defaultValues: { body: '' },
  })

  // Fail open while capabilities load or if they cannot be read: the server is still the
  // authority, and a suppressed message is shown as "Not sent" rather than lost silently.
  const sendingEnabled =
    capabilities.isPending || capabilities.isError || capabilities.isEnabled(FEATURES.dmReply)
  const { canReply, reason } = composerAvailability(conversation.state, sendingEnabled)
  const activeMode: Mode = canReply ? mode : 'note'
  const mutation = activeMode === 'reply' ? actions.reply : actions.note
  const copy = MODE_COPY[activeMode]

  const submit = form.handleSubmit(({ body }) => {
    mutation.mutate(body, {
      onSuccess: () => {
        form.reset({ body: '' })
      },
    })
  })

  const { ref: registerRef, ...bodyField } = form.register('body')
  const error = form.formState.errors.body?.message

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="border-line space-y-3 border-t p-4"
      noValidate
    >
      <fieldset className="bg-sunken flex w-fit gap-1 rounded-md p-1">
        <legend className="sr-only">Message type</legend>
        {(['reply', 'note'] as const).map((value) => {
          const disabled = value === 'reply' && !canReply
          return (
            <label key={value} className={cn(disabled && 'cursor-not-allowed opacity-50')}>
              <input
                type="radio"
                name="mode"
                value={value}
                checked={activeMode === value}
                disabled={disabled}
                onChange={() => {
                  setMode(value)
                }}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'text-ink-muted block cursor-pointer rounded px-3 py-1 text-sm font-medium transition-colors',
                  'peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-card',
                  'peer-focus-visible:outline-accent-600 peer-focus-visible:outline-2',
                  disabled && 'cursor-not-allowed',
                )}
              >
                {MODE_COPY[value].label}
              </span>
            </label>
          )
        })}
      </fieldset>

      {reason !== null && (
        <p role="status" className="text-ink-muted text-sm">
          {reason}
        </p>
      )}

      <div className="space-y-1.5">
        <Textarea
          {...bodyField}
          ref={registerRef}
          aria-label={copy.label}
          aria-invalid={error ? true : undefined}
          placeholder={activeMode === 'reply' ? 'Write a reply…' : 'Write a note for your team…'}
          rows={3}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
        {error ? (
          <p role="alert" className="text-danger-600 text-sm">
            {error}
          </p>
        ) : (
          <p className="text-ink-subtle text-sm">{copy.help} Press Ctrl or ⌘ + Enter to send.</p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={mutation.isPending}>
          {copy.submit}
        </Button>
      </div>
    </form>
  )
}
