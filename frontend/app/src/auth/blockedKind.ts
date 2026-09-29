import type { BlockedKind } from './AccessBlockedScreen'

export function blockedKindFromStatus(status: number): BlockedKind | null {
  if (status === 403) return '403'
  if (status === 409) return '409'
  return null
}
