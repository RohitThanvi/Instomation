import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { OnboardingDraft } from '../draft'
import { normalizeAutomation } from '../automation'
import { StepFrame } from '../step-frame'
import { stepPath } from '../steps'
import { businessSetupSchema, saveBusinessSetup, type BusinessSetup } from '@/api/business'
import { can } from '@/auth/permissions'
import { useRequiredOrganization, useSession } from '@/auth/session-context'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/config/constants'
import { describeAccount } from '@/features/instagram/account-status'
import { useCapabilities, useInstagramAccounts } from '@/features/instagram/use-instagram'

export function ActivateStep({ draft }: { draft: OnboardingDraft }) {
  const { client } = useSession()
  const { role } = useRequiredOrganization()
  const allowed = can(role, 'settings_manage')
  const capabilities = useCapabilities()
  const accounts = useInstagramAccounts()
  const save = useMutation({
    mutationFn: (setup: BusinessSetup) => saveBusinessSetup(client, setup),
  })

  if (capabilities.isPending) {
    return (
      <StepFrame title="Activate your assistant" description="One last look before it goes live.">
        <Skeleton className="h-40 w-full" />
      </StepFrame>
    )
  }
  if (capabilities.isError) {
    return (
      <StepFrame title="Activate your assistant" description="One last look before it goes live.">
        <ErrorState error={capabilities.error} onRetry={capabilities.refetch} />
      </StepFrame>
    )
  }

  const parsed = businessSetupSchema.safeParse(
    draft.automation === undefined
      ? draft
      : { ...draft, automation: normalizeAutomation(draft.automation, capabilities.isEnabled) },
  )
  const hasLiveAccount = accounts.data?.some((account) => describeAccount(account).isLive) ?? false

  if (save.isSuccess) {
    const {
      dm_automation_enabled: dms,
      comment_automation_enabled: comments,
      private_reply_enabled: privateReplies,
    } = save.data
    return (
      <StepFrame
        title="Your assistant is set up"
        description="Your business details are saved and your reply settings are in effect."
      >
        <ul className="text-ink space-y-1 text-sm">
          <li>Replying to direct messages: {dms ? 'on' : 'off'}</li>
          <li>Replying to comments: {comments ? 'on' : 'off'}</li>
          <li>Private messages to commenters: {privateReplies ? 'on' : 'off'}</li>
        </ul>
        {!hasLiveAccount && (
          <Notice tone="warning" title="No Instagram account is receiving messages yet">
            The assistant cannot answer anyone until an account is connected and receiving messages.
          </Notice>
        )}
        <div className="border-line flex items-center justify-end gap-3 border-t pt-6">
          <Button asChild variant="secondary">
            <Link to={ROUTES.inbox}>Open inbox</Link>
          </Button>
          <Button asChild>
            <Link to={ROUTES.home}>Go to overview</Link>
          </Button>
        </div>
      </StepFrame>
    )
  }

  return (
    <StepFrame
      title="Activate your assistant"
      description="Once active, the assistant starts handling the conversations you allowed."
    >
      {!allowed && (
        <Notice tone="info" title="Only owners and admins can activate the assistant">
          Ask an owner or admin to finish this step.
        </Notice>
      )}
      {!parsed.success && (
        <Notice
          tone="warning"
          title="Setup is not complete"
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link to={stepPath('review')}>Go to review</Link>
            </Button>
          }
        >
          Some steps still need your answers.
        </Notice>
      )}
      {parsed.success && !hasLiveAccount && (
        <Notice tone="warning" title="No Instagram account is receiving messages yet">
          You can activate now, but the assistant cannot answer anyone until an account is connected
          and receiving messages.
        </Notice>
      )}
      {save.isError && (
        <>
          <ErrorState error={save.error} title="Activation failed" />
          <p className="text-ink-muted text-sm">
            Your answers are kept. It is safe to try again: replies are only switched on once
            everything else has saved.
          </p>
        </>
      )}
      <div className="border-line flex items-center justify-between border-t pt-6">
        <Button asChild variant="ghost">
          <Link to={stepPath('review')}>Back</Link>
        </Button>
        <Button
          loading={save.isPending}
          disabled={!parsed.success || !allowed}
          onClick={() => {
            if (parsed.success) save.mutate(parsed.data)
          }}
        >
          Activate assistant
        </Button>
      </div>
    </StepFrame>
  )
}
