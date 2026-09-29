import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/** Heading + body. Focus moves to the heading on each step so screen-reader users hear the change. */
export function StepFrame({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <section className="animate-fade-in space-y-8">
      <header className="space-y-2">
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-display text-3xl font-medium tracking-tight outline-none"
        >
          {title}
        </h1>
        <p className="text-ink-muted max-w-xl">{description}</p>
      </header>
      {children}
    </section>
  )
}

interface StepFooterProps {
  onBack?: (() => void) | undefined
  submitLabel: string
  submitting?: boolean
  submitDisabled?: boolean
  submitVariant?: 'primary' | 'secondary'
}

export function StepFooter({
  onBack,
  submitLabel,
  submitting = false,
  submitDisabled = false,
  submitVariant = 'primary',
}: StepFooterProps) {
  return (
    <div className="border-line flex items-center justify-between gap-3 border-t pt-6">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button type="submit" variant={submitVariant} loading={submitting} disabled={submitDisabled}>
        {submitLabel}
      </Button>
    </div>
  )
}
