import type { ReactNode } from 'react'
import { Atomaro } from '../ds/atomaro'
import { ToastCtx, type ToastInput } from './ToastContext'

function ToastBridge({ children }: { children: ReactNode }) {
  // хук из UMD-бандла, а Atomaro типизирован как набор компонентов
  const { addNotification } = (Atomaro.useNotificationsStack as unknown as () => { addNotification: (n: object) => void })()

  const push = (t: ToastInput) => {
    addNotification({
      title: t.title,
      subtitle: t.subtitle,
      colorScheme: t.colorScheme ?? 'info',
      timeout: 6000,
      actionButtons:
        t.actionLabel && t.onAction ? [{ children: t.actionLabel, action: () => t.onAction?.() }] : [],
    })
  }

  return <ToastCtx.Provider value={push}>{children}</ToastCtx.Provider>
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Atomaro.ToastNotificationsProvider>
      <ToastBridge>{children}</ToastBridge>
    </Atomaro.ToastNotificationsProvider>
  )
}
