export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(describeDetail(detail) || `Ошибка API: ${status}`)
    this.status = status
    this.detail = detail
  }
}

function describeDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // ошибки валидации pydantic: [{msg, loc, ...}]
    return detail.map((d) => (typeof d === 'object' && d && 'msg' in d ? String((d as any).msg) : String(d))).join('; ')
  }
  return null
}

// вызывается из AuthGuard, чтобы увести на экран входа при протухшей сессии
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError(401, 'Не авторизован')
  }

  if (res.status === 204) return undefined as T

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    throw new ApiError(res.status, payload?.detail ?? payload)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
