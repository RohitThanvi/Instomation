import { createContext, useContext } from 'react'

export type ToastVariant = 'success' | 'error'
export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
}

export const ToastContext = createContext<((input: ToastInput) => void) | null>(null)

export function useToast(): (input: ToastInput) => void {
  const push = useContext(ToastContext)
  if (push === null) throw new Error('useToast must be used inside <ToastProvider>')
  return push
}
