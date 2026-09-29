import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { buildCommitments } from '../automation'
import type { OnboardingDraft } from '../draft'
import { StepFooter, StepFrame } from '../step-frame'
import { stepPath, type StepSlug } from '../steps'
import { TONE_OPTIONS } from '../tone-examples'
import type { Organization } from '@/api/organizations'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { Skeleton } from '@/components/ui/skeleton'
import { describeAccount } from '@/features/instagram/account-status'
import { useCapabilities, useInstagramAccounts } from '@/features/instagram/use-instagram'

const SECTIONS: readonly { key: keyof OnboardingDraft; slug: StepSlug; title: string }[] = [
  { key: 'profile', slug: 'profile', title: 'Profile' },
  { key: 'products', slug: 'offerings', title: 'Products and services' },
  { key: 'style', slug: 'voice', title: 'Communication style' },
  { key: 'automation', slug: 'automation', title: 'Automation' },
]

function ReviewCard({
  title,
  slug,
  children,
}: {
  title: string
  slug: StepSlug
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link to={stepPath(slug)} className="text-accent-700 text-sm font-medium hover:underline">
          Edit<span className="sr-only"> {title}</span>
        </Link>
      </CardHeader>
      <CardContent className="text-ink-muted space-y-1 text-sm">{children}</CardContent>
    </Card>
  )
}

function InstagramSummary() {
  const accounts = useInstagramAccounts()
  if (accounts.isPending) return <Skeleton className="h-10 w-full" />
  if (accounts.isError)
    return (
      <ErrorState
        error={accounts.error}
        title="We could not check your Instagram connection"
        onRetry={() => void accounts.refetch()}
      />
    )
  const live = accounts.data.filter((account) => describeAccount(account).isLive)
  if (live.length > 0)
    return <p>Connected: {live.map((account) => `@${account.username}`).join(', ')}</p>
  return (
    <p>
      No Instagram account is receiving messages yet. The assistant cannot answer anyone until one
      is.
    </p>
  )
}

interface Props {
  organization: Organization
  draft: OnboardingDraft
  onNext: () => void
  onBack: () => void
}

export function ReviewStep({ organization, draft, onNext, onBack }: Props) {
  const capabilities = useCapabilities()
  const missing = SECTIONS.filter((section) => draft[section.key] === undefined)
  const { will, willNot } = buildCommitments(draft.automation, capabilities.isEnabled)
  const tone = TONE_OPTIONS.find((option) => option.value === draft.style?.tone)

  return (
    <StepFrame
      title="Review your setup"
      description="Check everything, and see exactly what the assistant will and will not do."
    >
      {missing.length > 0 && (
        <Notice tone="warning" title="A few steps are not finished">
          Complete {missing.map((section) => section.title).join(', ')} to continue.
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <ReviewCard title="Workspace" slug="account-type">
          <p className="text-ink font-medium">{organization.name}</p>
        </ReviewCard>
        <ReviewCard title="Instagram" slug="instagram">
          <InstagramSummary />
        </ReviewCard>
        {draft.profile && (
          <ReviewCard title="Profile" slug="profile">
            <p className="text-ink font-medium">{draft.profile.brand_name}</p>
            <p>{draft.profile.category}</p>
            <p>{draft.profile.description}</p>
          </ReviewCard>
        )}
        {draft.products && (
          <ReviewCard title="Products and services" slug="offerings">
            <p>
              {draft.products.items.length === 0
                ? 'None added yet.'
                : draft.products.items.map((item) => item.name).join(', ')}
            </p>
          </ReviewCard>
        )}
        {draft.style && (
          <ReviewCard title="Communication style" slug="voice">
            <p className="text-ink font-medium">{tone?.label}</p>
            {draft.style.notes && <p>{draft.style.notes}</p>}
          </ReviewCard>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>The assistant will</CardTitle>
          </CardHeader>
          <CardContent>
            {capabilities.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : will.length === 0 ? (
              <p className="text-ink-muted text-sm">
                Nothing yet. Turn on an action in the Automation step.
              </p>
            ) : (
              <ul className="text-ink-muted list-disc space-y-1.5 pl-5 text-sm">
                {will.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>The assistant will never</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-ink-muted list-disc space-y-1.5 pl-5 text-sm">
              {willNot.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          onNext()
        }}
      >
        <StepFooter
          onBack={onBack}
          submitLabel="Continue to activation"
          submitDisabled={missing.length > 0}
        />
      </form>
    </StepFrame>
  )
}
