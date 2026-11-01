import { useState } from 'react'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Notice } from '@/components/ui/notice'
import { SelectField } from '@/components/ui/select-field'
import { TextAreaField } from '@/components/ui/text-field'
import { REASON_LABELS } from '@/features/handoffs/labels'
import { describeAction } from './labels'
import { usePreviewRule } from './use-automations'

type Scope = 'dm' | 'comment'

export function PreviewPanel() {
  const [scope, setScope] = useState<Scope>('dm')
  const [text, setText] = useState('')
  const preview = usePreviewRule()
  const result = preview.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>Try a message</CardTitle>
        <CardDescription>
          See which rule would answer a message. This only looks at your rules: the safety checks
          and the assistant&apos;s other limits still apply to real messages first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim() !== '') preview.mutate({ scope, text: text.trim() })
          }}
        >
          <SelectField
            label="It arrives as"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value === 'comment' ? 'comment' : 'dm')
              preview.reset()
            }}
          >
            <option value="dm">A direct message</option>
            <option value="comment">A comment</option>
          </SelectField>
          <TextAreaField
            label="The message"
            rows={2}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              preview.reset()
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={text.trim() === ''}
            loading={preview.isPending}
          >
            Check
          </Button>
        </form>
        <div aria-live="polite" className="mt-4">
          {preview.isError && (
            <Notice tone="danger" title="We could not check that">
              {errorMessage(preview.error)}
            </Notice>
          )}
          {result !== undefined &&
            (result.rule === null ? (
              <Notice tone="info" title="No rule matches">
                The assistant would answer this itself.
              </Notice>
            ) : (
              <Notice tone="success" title={`“${result.rule.name}” would answer this`}>
                {describeAction(result.rule)}
                {result.rule.action === 'handoff' && result.rule.handoff_reason !== null
                  ? `: ${REASON_LABELS[result.rule.handoff_reason]}`
                  : ''}
                .
              </Notice>
            ))}
        </div>
      </CardContent>
    </Card>
  )
}
