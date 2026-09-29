import type { ReactNode } from 'react'
import { useMe } from './useMe'
import { LoginPage } from './LoginPage'
import { AccessBlockedScreen } from './AccessBlockedScreen'
import { blockedKindFromStatus } from './blockedKind'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error } = useMe()

  if (isLoading) return null

  if (error) {
    if (error.status === 401) return <LoginPage />
    const blocked = blockedKindFromStatus(error.status)
    if (blocked) return <AccessBlockedScreen kind={blocked} />
    return <LoginPage />
  }

  if (!me) return <LoginPage />

  return <>{children}</>
}
