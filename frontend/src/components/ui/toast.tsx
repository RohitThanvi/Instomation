import * as ToastPrimitive from '@radix-ui/react-toast'
import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ToastContext, type ToastInput } from './toast-context'
import { cn } from '@/lib/cn'

interface ToastItem extends ToastInput {
  id: number
}

const TOAST_DURATION_MS = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((input: ToastInput) => {
    setItems((current) => [...current, { ...input, id: Date.now() + Math.random() }])
  }, [])
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])
  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider duration={TOAST_DURATION_MS} swipeDirection="right">
        {children}
        {items.map((item) => {
          const isError = item.variant === 'error'
          const Icon = isError ? CircleAlert : CheckCircle2
          return (
            <ToastPrimitive.Root
              key={item.id}
              type={isError ? 'foreground' : 'background'}
              onOpenChange={(open) => {
                if (!open) dismiss(item.id)
              }}
              className="animate-fade-in border-line bg-surface shadow-raised flex items-start gap-3 rounded-lg border p-4"
            >
              <Icon
                className={cn(
                  'mt-0.5 size-5 shrink-0',
                  isError ? 'text-danger-600' : 'text-success-600',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <ToastPrimitive.Title className="text-ink text-sm font-medium">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description && (
                  <ToastPrimitive.Description className="text-ink-muted text-sm">
                    {item.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close
                aria-label="Dismiss notification"
                className="text-ink-subtle hover:bg-sunken hover:text-ink rounded-sm p-1"
              >
                <X className="size-4" aria-hidden />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          )
        })}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
