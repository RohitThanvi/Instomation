import { UserButton } from '@clerk/clerk-react'
import type { ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useOnboardingDraft } from './draft'
import { StepProgress } from './step-progress'
import {
  ACCOUNT_TYPE_INDEX,
  ONBOARDING_STEPS,
  stepAt,
  stepIndex,
  stepPath,
  type StepSlug,
} from './steps'
import { AccountTypeStep } from './steps/account-type-step'
import { ActivateStep } from './steps/activate-step'
import { AutomationStep } from './steps/automation-step'
import { ConnectStep } from './steps/connect-step'
import { OfferingsStep } from './steps/offerings-step'
import { ProfileStep } from './steps/profile-step'
import { ReviewStep } from './steps/review-step'
import { VoiceStep } from './steps/voice-step'
import { WelcomeStep } from './steps/welcome-step'
import { useSession } from '@/auth/session-context'
import { Brand } from '@/components/layout/brand'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'

function Shell({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="bg-canvas min-h-dvh">
      <header className="border-line bg-surface flex h-16 items-center justify-between border-b px-4 md:px-8">
        <Brand />
        <UserButton />
      </header>
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 md:py-14">
        <StepProgress currentIndex={index} />
        {children}
      </main>
    </div>
  )
}

function Flow({ index }: { index: number }) {
  const { currentOrganization: organization } = useSession()
  const { draft, saveSection } = useOnboardingDraft(organization?.id ?? null)
  const navigate = useNavigate()
  const slug: StepSlug | null = stepAt(index)

  // Every step after the workspace is created needs the workspace to exist.
  if (slug === null || (organization === null && index > ACCOUNT_TYPE_INDEX)) {
    return <Navigate to={stepPath('account-type')} replace />
  }

  const goTo = (target: number) => {
    const targetSlug = stepAt(target)
    if (targetSlug !== null) void navigate(stepPath(targetSlug))
  }
  const next = () => {
    goTo(index + 1)
  }
  const back = () => {
    goTo(index - 1)
  }

  const content = (() => {
    switch (slug) {
      case 'welcome':
        return <WelcomeStep onNext={next} />
      case 'account-type':
        return <AccountTypeStep organization={organization} onNext={next} onBack={back} />
      case 'instagram':
        return <ConnectStep onNext={next} onBack={back} />
      case 'profile':
        return (
          organization && (
            <ProfileStep
              accountType={organization.account_type}
              organizationName={organization.name}
              defaults={draft.profile}
              onBack={back}
              onSubmit={(values) => {
                saveSection('profile', values)
                next()
              }}
            />
          )
        )
      case 'offerings':
        return (
          <OfferingsStep
            defaults={draft.products}
            onBack={back}
            onSubmit={(values) => {
              saveSection('products', values)
              next()
            }}
          />
        )
      case 'voice':
        return (
          <VoiceStep
            defaults={draft.style}
            onBack={back}
            onSubmit={(values) => {
              saveSection('style', values)
              next()
            }}
          />
        )
      case 'automation':
        return (
          <AutomationStep
            defaults={draft.automation}
            onBack={back}
            onSubmit={(values) => {
              saveSection('automation', values)
              next()
            }}
          />
        )
      case 'review':
        return (
          organization && (
            <ReviewStep organization={organization} draft={draft} onNext={next} onBack={back} />
          )
        )
      case 'activate':
        return <ActivateStep draft={draft} />
    }
  })()

  return <Shell index={index}>{content}</Shell>
}

export function OnboardingPage() {
  const { step } = useParams()
  const { organizationsStatus, organizationsError, refetchOrganizations, currentOrganization } =
    useSession()
  const index = stepIndex(step)

  if (index === -1) return <Navigate to={stepPath(ONBOARDING_STEPS[0].slug)} replace />
  if (organizationsStatus === 'pending') {
    return (
      <Shell index={index}>
        <Skeleton className="h-64 w-full" />
      </Shell>
    )
  }
  if (organizationsStatus === 'error') {
    return (
      <Shell index={index}>
        <ErrorState
          error={organizationsError}
          title="We could not load your workspace"
          onRetry={refetchOrganizations}
        />
      </Shell>
    )
  }
  // Remount when the workspace changes so drafts never leak between workspaces.
  return <Flow key={currentOrganization?.id ?? 'none'} index={index} />
}
