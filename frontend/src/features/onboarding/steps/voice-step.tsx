import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { StepFooter, StepFrame } from '../step-frame'
import { EXAMPLE_QUESTION, TONE_OPTIONS } from '../tone-examples'
import { BUSINESS_LIMITS, styleSchema, type StyleValues } from '@/api/business'
import { ChatBubble } from '@/components/ui/chat-bubble'
import { RadioCards } from '@/components/ui/radio-cards'
import { TextAreaField } from '@/components/ui/text-field'

interface Props {
  defaults: StyleValues | undefined
  onSubmit: (values: StyleValues) => void
  onBack: () => void
}

export function VoiceStep({ defaults, onSubmit, onBack }: Props) {
  const form = useForm<StyleValues>({
    resolver: zodResolver(styleSchema),
    defaultValues: defaults ?? { tone: 'professional', notes: '' },
  })
  const tone = useWatch({ control: form.control, name: 'tone' })
  const example = TONE_OPTIONS.find((option) => option.value === tone)?.example
  const submit = form.handleSubmit(onSubmit)

  return (
    <StepFrame
      title="How should the assistant sound?"
      description="Pick the voice that fits your brand. It is the tone every reply is written in."
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-8">
        <RadioCards
          legend="Communication style"
          options={TONE_OPTIONS}
          registration={form.register('tone')}
          error={form.formState.errors.tone ? 'Choose a style' : undefined}
        />
        {example && (
          <div
            className="border-line bg-surface shadow-card space-y-3 rounded-lg border p-5"
            aria-live="polite"
          >
            <p className="text-ink-subtle text-xs font-medium tracking-wide uppercase">
              Example only, not a real conversation
            </p>
            <ChatBubble side="customer">{EXAMPLE_QUESTION}</ChatBubble>
            <ChatBubble side="assistant">{example}</ChatBubble>
          </div>
        )}
        <TextAreaField
          label="Anything else about your voice? (optional)"
          hint="For example: never use exclamation marks, or always sign off with your first name."
          maxLength={BUSINESS_LIMITS.styleNotes}
          error={form.formState.errors.notes?.message}
          {...form.register('notes')}
        />
        <StepFooter onBack={onBack} submitLabel="Continue" />
      </form>
    </StepFrame>
  )
}
