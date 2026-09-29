import { createContext, useContext } from 'react'

export interface ToastInput {
  title: string
  subtitle?: string
  colorScheme?: 'success' | 'error' | 'warning' | 'info' | 'neutral'
  actionLabel?: string
  onAction?: () => void
}

export const ToastCtx = createContext<(t: ToastInput) => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}
