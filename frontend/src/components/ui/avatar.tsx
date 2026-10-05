import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'
import { initialsOf } from '@/lib/initials'

const avatarVariants = cva(
  'bg-sunken text-ink-muted inline-grid shrink-0 place-items-center rounded-full font-medium',
  {
    variants: { size: { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' } },
    defaultVariants: { size: 'md' },
  },
)

/** Initials only: Instagram profile photos are not available through the API we use. */
export function Avatar({
  name,
  size,
  className,
}: { name: string; className?: string } & VariantProps<typeof avatarVariants>) {
  return (
    <span aria-hidden className={cn(avatarVariants({ size }), className)}>
      {initialsOf(name)}
    </span>
  )
}
