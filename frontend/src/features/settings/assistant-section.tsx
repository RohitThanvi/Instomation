import { useState } from 'react'
import { AI_LIMITS, type AiSettings } from '@/api/business'
import { FEATURES } from '@/api/instagram'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { RangeField } from '@/components/ui/range-field'
import { Skeleton } from '@/components/ui/skeleton'
import { TextField } from '@/components/ui/text-field'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useCapabilities } from '@/features/instagram/use-instagram'
import { errorMessage } from '@/api/errors'
import { aiPatch, aiToForm, validateAi, type AiForm, type Offered } from './ai-form'
import { useAiSettings, useSaveAiSettings } from './use-settings'

const percent = (value: number) => `${String(value)}%`

export function AssistantSection() {
  const settings = useAiSettings()
  const capabilities = useCapabilities()
  let body
  if (settings.isPending || capabilities.isPending) {
    body = <Skeleton className="h-64 w-full" />
  } else if (settings.isError || capabilities.isError) {
    body = (
      <ErrorState
        error={settings.error ?? capabilities.error}
        title="We could not load the assistant settings"
        onRetry={() => {
          void settings.refetch()
          capabilities.refetch()
        }}
      />
    )
  } else {
    const offered: Offered = {
      dm: capabilities.isEnabled(FEATURES.dmReply),
      comments: capabilities.isEnabled(FEATURES.commentReply),
      privateReply: capabilities.isEnabled(FEATURES.privateReply),
    }
    // Remounting on the saved values resets the form to what the server now holds.
    body = (
      <AssistantForm
        key={JSON.stringify(settings.data)}
        settings={settings.data}
        offered={offered}
      />
    )
  }
  return (
    <section aria-labelledby="assistant-heading" className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle id="assistant-heading">Assistant</CardTitle>
          <CardDescription>
            What the assistant answers, and how careful it is before it does.
          </CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </section>
  )
}

function AssistantForm({ settings, offered }: { settings: AiSettings; offered: Offered }) {
  const [values, setValues] = useState<AiForm>(() => aiToForm(settings))
  const save = useSaveAiSettings()
  const set = (change: Partial<AiForm>) => {
    save.reset()
    setValues((current) => ({ ...current, ...change }))
  }
  const errors = validateAi(values)
  const valid = Object.keys(errors).length === 0
  const patch = valid ? aiPatch(settings, values, offered) : {}
  const changed = Object.keys(patch).length > 0
  // A private reply answers a comment, so it is only offered while comment replies are on.
  const offerPrivateReply = offered.privateReply && values.comments

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && changed) save.mutate(patch)
      }}
    >
      <div className="space-y-3">
        {!offered.dm && !offered.comments && (
          <Notice tone="info" title="No reply actions are available for this workspace right now">
            The switches appear here once they are turned on for your workspace.
          </Notice>
        )}
        {offered.comments && (
          <ToggleRow
            label="Reply to comments"
            description="Answer questions and comments on your posts."
            checked={values.comments}
            onCheckedChange={(comments) => {
              set({ comments })
            }}
          />
        )}
        {offerPrivateReply && (
          <ToggleRow
            label="Continue a comment in private"
            description="When a public reply is not enough, also send the commenter one private message with the details. Instagram allows one per comment, within 7 days."
            checked={values.privateReply}
            onCheckedChange={(privateReply) => {
              set({ privateReply })
            }}
          />
        )}
        {offered.dm && (
          <ToggleRow
            label="Reply to direct messages"
            description="Answer people who message you first."
            checked={values.dm}
            onCheckedChange={(dm) => {
              set({ dm })
            }}
          />
        )}
      </div>

      <RangeField
        label="Minimum confidence to reply"
        lowLabel="Replies more"
        highLabel="Hands over more"
        hint="When the assistant is less sure than this about a reply, it does not send it and hands the conversation to your team."
        value={values.confidence}
        format={percent}
        onChange={(confidence) => {
          set({ confidence })
        }}
      />
      <RangeField
        label="Reply style"
        lowLabel="Precise"
        highLabel="Creative"
        hint="Lower keeps replies close to your business details. Higher varies the wording more."
        value={values.creativity}
        format={percent}
        onChange={(creativity) => {
          set({ creativity })
        }}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Longest reply"
          type="number"
          inputMode="numeric"
          min={AI_LIMITS.tokens.min}
          max={AI_LIMITS.tokens.max}
          hint={`In tokens, roughly three-quarters of a word each. ${String(AI_LIMITS.tokens.min)} to ${String(AI_LIMITS.tokens.max)}.`}
          error={errors.maxTokens}
          value={values.maxTokens}
          onChange={(event) => {
            set({ maxTokens: event.target.value })
          }}
        />
        <TextField
          label="Replies per conversation per hour"
          type="number"
          inputMode="numeric"
          min={AI_LIMITS.replies.min}
          max={AI_LIMITS.replies.max}
          hint={`A safety cap so one conversation is never flooded. ${String(AI_LIMITS.replies.min)} to ${String(AI_LIMITS.replies.max)}.`}
          error={errors.maxReplies}
          value={values.maxReplies}
          onChange={(event) => {
            set({ maxReplies: event.target.value })
          }}
        />
      </div>

      {save.isError && (
        <Notice tone="danger" title="We could not save your changes">
          {errorMessage(save.error)}
        </Notice>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!valid || !changed} loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}
