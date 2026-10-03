import { Check } from 'lucide-react'
import { ONBOARDING_STEPS } from './steps'
import { cn } from '@/lib/cn'

export function StepProgress({ currentIndex }: { currentIndex: number }) {
  const total = ONBOARDING_STEPS.length
  return (
    <nav aria-label="Setup progress" className="space-y-3">
      <p className="text-ink-muted text-sm">
        Step {currentIndex + 1} of {total}
        <span className="sr-only">: {ONBOARDING_STEPS[currentIndex]?.title}</span>
      </p>
      <ol className="flex gap-1.5">
        {ONBOARDING_STEPS.map((step, index) => (
          <li
            key={step.slug}
            aria-current={index === currentIndex ? 'step' : undefined}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              index <= currentIndex ? 'bg-accent-600' : 'bg-line-strong',
            )}
          >
            <span className="sr-only">
              {step.title}
              {index < currentIndex ? ' (done)' : ''}
            </span>
          </li>
        ))}
      </ol>
      <ol className="hidden flex-wrap gap-x-5 gap-y-1 text-xs lg:flex" aria-hidden>
        {ONBOARDING_STEPS.map((step, index) => (
          <li
            key={step.slug}
            className={cn(
              'flex items-center gap-1',
              index === currentIndex ? 'text-ink font-medium' : 'text-ink-subtle',
            )}
          >
            {index < currentIndex && <Check className="text-success-600 size-3" />}
            {step.title}
          </li>
        ))}
      </ol>
    </nav>
  )
}
