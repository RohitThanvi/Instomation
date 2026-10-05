import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface ChatBubbleProps {
  /** `customer` on the left; `assistant` (the AI) and `team` (a person) on the right. */
  side: 'customer' | 'assistant' | 'team'
  children: ReactNode
  /** Small caption under the bubble (time, delivery status, intent). */
  footer?: ReactNode
}

const BUBBLE_CLASSES: Record<ChatBubbleProps['side'], string> = {
  customer: 'bg-sunken text-ink rounded-bl-md',
  assistant: 'bg-accent-600 rounded-br-md text-white',
  team: 'bg-ink rounded-br-md text-white',
}

export function ChatBubble({ side, children, footer }: ChatBubbleProps) {
  const isRight = side !== 'customer'
  return (
    <div className={cn('flex flex-col gap-1', isRight ? 'items-end' : 'items-start')}>
      <p
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap',
          BUBBLE_CLASSES[side],
        )}
      >
        {children}
      </p>
      {footer && <div className="text-ink-subtle max-w-[85%] px-1 text-xs">{footer}</div>}
    </div>
  )
}
