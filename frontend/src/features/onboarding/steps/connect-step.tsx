import { StepFooter, StepFrame } from '../step-frame'
import { describeAccount } from '@/features/instagram/account-status'
import { InstagramConnection } from '@/features/instagram/instagram-connection'
import { useInstagramAccounts } from '@/features/instagram/use-instagram'

export function ConnectStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const accounts = useInstagramAccounts()
  const hasLiveAccount = accounts.data?.some((account) => describeAccount(account).isLive) ?? false

  return (
    <StepFrame
      title="Connect your Instagram"
      description="Instomation needs access to your Instagram Business or Creator account to see and answer messages and comments."
    >
      <InstagramConnection returnToOnboarding />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onNext()
        }}
      >
        <StepFooter
          onBack={onBack}
          submitLabel={hasLiveAccount ? 'Continue' : 'Skip for now'}
          submitVariant={hasLiveAccount ? 'primary' : 'secondary'}
        />
      </form>
    </StepFrame>
  )
}
