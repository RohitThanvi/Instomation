import { useId, type ComponentProps } from 'react'
import { controlClasses } from './input'
import { cn } from '@/lib/cn'

export function SelectField({
  label,
  className,
  children,
  ...props
}: ComponentProps<'select'> & { label: string }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
      </label>
      <select id={id} className={cn(controlClasses, 'h-10', className)} {...props}>
        {children}
      </select>
    </div>
  )
}
