import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const controlClasses =
  'w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink shadow-card transition-colors placeholder:text-ink-subtle hover:border-ink-subtle disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger-600'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClasses, 'h-10', className)} {...props} />
}
