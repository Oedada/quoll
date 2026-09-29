import type { DemoAccount } from '../api/types'

// /auth/* не под /api/v1 и не JSON-API в привычном смысле (редиректы) - свой,
// более простой клиент, без ApiError-обёртки
export async function fetchDemoAccounts(): Promise<DemoAccount[]> {
  const res = await fetch('/auth/demo-accounts', { credentials: 'include' })
  if (!res.ok) return []
  return res.json()
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
}

export function goToKeycloakLogin() {
  window.location.href = '/auth/'
}
