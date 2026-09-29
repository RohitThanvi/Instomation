import type { ComponentProps } from 'react'
import { controlClasses } from './input'
import { cn } from '@/lib/cn'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlClasses, 'min-h-24 py-2', className)} {...props} />
}
