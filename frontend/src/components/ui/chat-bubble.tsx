import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface ChatBubbleProps {
  side: 'customer' | 'assistant'
  children: ReactNode
}

export function ChatBubble({ side, children }: ChatBubbleProps) {
  const isAssistant = side === 'assistant'
  return (
    <div className={cn('flex', isAssistant ? 'justify-end' : 'justify-start')}>
      <p
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isAssistant
            ? 'bg-accent-600 rounded-br-md text-white'
            : 'bg-sunken text-ink rounded-bl-md',
        )}
      >
        {children}
      </p>
    </div>
  )
}
