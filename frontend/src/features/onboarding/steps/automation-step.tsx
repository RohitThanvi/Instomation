import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { StepFooter, StepFrame } from '../step-frame'
import { DEFAULT_AUTOMATION, HANDOFF_RULES, normalizeAutomation } from '../automation'
import { automationPreferencesSchema, type AutomationPreferences } from '@/api/business'
import { FEATURES } from '@/api/instagram'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useCapabilities } from '@/features/instagram/use-instagram'

interface FormProps {
  defaults: AutomationPreferences | undefined
  isEnabled: (feature: string) => boolean
  onSubmit: (values: AutomationPreferences) => void
  onBack: () => void
}

function AutomationForm({ defaults, isEnabled, onSubmit, onBack }: FormProps) {
  const form = useForm<AutomationPreferences>({
    resolver: zodResolver(automationPreferencesSchema),
    defaultValues: normalizeAutomation(defaults ?? DEFAULT_AUTOMATION, isEnabled),
  })
  const submit = form.handleSubmit((values) => {
    onSubmit(normalizeAutomation(values, isEnabled))
  })

  // Controls exist only for actions the server has enabled. Nothing else is rendered.
  const replyControls = [
    {
      feature: FEATURES.commentReply,
      name: 'reply_to_comments',
      label: 'Reply to comments',
      description: 'Answer questions and comments on your posts.',
    },
    {
      feature: FEATURES.dmReply,
      name: 'reply_to_dms',
      label: 'Reply to direct messages',
      description: 'Answer people who message you first.',
    },
  ] as const
  const available = replyControls.filter((control) => isEnabled(control.feature))

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-8">
      <div className="space-y-3">
        <h2 className="text-ink text-sm font-medium">What the assistant may do</h2>
        {available.length === 0 ? (
          <Notice tone="info" title="No reply actions are available for this workspace right now">
            You can still finish setup. Reply actions will appear here once they are switched on.
          </Notice>
        ) : (
          available.map((control) => (
            <ToggleRow
              key={control.name}
              label={control.label}
              description={control.description}
              registration={form.register(control.name)}
            />
          ))
        )}
        {available.length < replyControls.length && available.length > 0 && (
          <p className="text-ink-subtle text-sm">
            Some actions are not available for this workspace.
          </p>
        )}
      </div>
      <div className="space-y-3">
        <h2 className="text-ink text-sm font-medium">When it brings in a person</h2>
        <p className="text-ink-muted text-sm">
          This is automatic and cannot be switched off. The assistant hands the conversation to you
          when:
        </p>
        <ul className="text-ink-muted list-disc space-y-1 pl-5 text-sm">
          {HANDOFF_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
      <StepFooter onBack={onBack} submitLabel="Continue" />
    </form>
  )
}

interface Props {
  defaults: AutomationPreferences | undefined
  onSubmit: (values: AutomationPreferences) => void
  onBack: () => void
}

export function AutomationStep({ defaults, onSubmit, onBack }: Props) {
  const capabilities = useCapabilities()
  return (
    <StepFrame
      title="Automation preferences"
      description="Choose what the assistant handles on its own, and when it should step aside for you."
    >
      {capabilities.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : capabilities.isError ? (
        <ErrorState
          error={capabilities.error}
          title="We could not check which actions are available"
          onRetry={capabilities.refetch}
        />
      ) : (
        <AutomationForm
          defaults={defaults}
          isEnabled={capabilities.isEnabled}
          onSubmit={onSubmit}
          onBack={onBack}
        />
      )}
    </StepFrame>
  )
}
