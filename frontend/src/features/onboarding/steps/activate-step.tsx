import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { OnboardingDraft } from '../draft'
import { normalizeAutomation } from '../automation'
import { StepFrame } from '../step-frame'
import { stepPath } from '../steps'
import { businessSetupSchema, saveBusinessSetup, type BusinessSetup } from '@/api/business'
import { isNotYetAvailable } from '@/api/unavailable'
import { useSession } from '@/auth/session-context'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { NotYetAvailable } from '@/components/ui/not-yet-available'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/config/constants'
import { describeAccount } from '@/features/instagram/account-status'
import { useCapabilities, useInstagramAccounts } from '@/features/instagram/use-instagram'

export function ActivateStep({ draft }: { draft: OnboardingDraft }) {
  const { client } = useSession()
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

  if (isNotYetAvailable(save.error)) {
    return (
      <StepFrame title="Activate your assistant" description="One last look before it goes live.">
        <NotYetAvailable
          feature="Activating your assistant"
          actions={
            <>
              <Button asChild variant="secondary">
                <Link to={stepPath('review')}>Back to review</Link>
              </Button>
              <Button asChild>
                <Link to={ROUTES.home}>Go to overview</Link>
              </Button>
            </>
          }
        >
          <p>
            Saving these settings is not built yet, so nothing was activated and your assistant is
            not replying to anyone.
          </p>
          <p>
            Your answers are kept in this browser for this workspace, so you will not need to enter
            them again.
          </p>
        </NotYetAvailable>
      </StepFrame>
    )
  }

  return (
    <StepFrame
      title="Activate your assistant"
      description="Once active, the assistant starts handling the conversations you allowed."
    >
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
      {save.isError && <ErrorState error={save.error} title="Activation failed" />}
      <div className="border-line flex items-center justify-between border-t pt-6">
        <Button asChild variant="ghost">
          <Link to={stepPath('review')}>Back</Link>
        </Button>
        <Button
          loading={save.isPending}
          disabled={!parsed.success}
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
