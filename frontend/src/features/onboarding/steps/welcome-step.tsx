import { CheckCircle2 } from 'lucide-react'
import { StepFrame } from '../step-frame'
import { ONBOARDING_STEPS } from '../steps'
import { Button } from '@/components/ui/button'

const PROMISES = [
  'Replies to comments and messages in your voice, using only Instagram’s official tools.',
  'Recognises leads and hands the conversation to you when a person is needed.',
  'You stay in control: everything you choose here can be changed later.',
] as const

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const upcoming = ONBOARDING_STEPS.slice(1)
  return (
    <StepFrame
      title="Welcome to Instomation"
      description="A few short steps to set up your assistant. You will review everything before anything goes live."
    >
      <ul className="space-y-3">
        {PROMISES.map((promise) => (
          <li key={promise} className="text-ink-muted flex items-start gap-3 text-sm">
            <CheckCircle2 className="text-success-600 mt-0.5 size-5 shrink-0" aria-hidden />
            {promise}
          </li>
        ))}
      </ul>
      <div className="border-line bg-surface shadow-card space-y-3 rounded-lg border p-5">
        <p className="text-ink text-sm font-medium">What we will cover</p>
        <ol className="text-ink-muted grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {upcoming.map((step, index) => (
            <li key={step.slug}>
              <span className="text-ink-subtle">{index + 1}.</span> {step.title}
            </li>
          ))}
        </ol>
      </div>
      <div className="border-line flex justify-end border-t pt-6">
        <Button onClick={onNext}>Get started</Button>
      </div>
    </StepFrame>
  )
}
