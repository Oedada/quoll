import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface NotificationRead {
  id: number
  notification_id: number
  type: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  subject_type: string
  subject_id: string | null
  interaction_id: number | null
  actor_id: string | null
  title: string
  body: string
  payload: Record<string, unknown>
  role: string
  read_at: string | null
  created_at: string
}

export interface UnreadCount {
  total: number
  by_severity: Record<string, number>
}

export function useNotifications() {
  return useQuery<NotificationRead[]>({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationRead[]>('/notifications/me'),
  })
}

export function useUnreadCount() {
  return useQuery<UnreadCount>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<UnreadCount>('/notifications/me/unread-count'),
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { ids?: number[]; all?: boolean; interaction_id?: number }) =>
      api.post('/notifications/me/read', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

// админская лента: все доставки (не только свои)

export interface AllNotificationsParams {
  user_id?: string
  type?: string
  interaction_id?: number
  before_id?: number
  limit?: number
}

function buildAllQuery(params: AllNotificationsParams): string {
  const sp = new URLSearchParams()
  if (params.user_id) sp.set('user_id', params.user_id)
  if (params.type) sp.set('type', params.type)
  if (params.interaction_id !== undefined) sp.set('interaction_id', String(params.interaction_id))
  if (params.before_id !== undefined) sp.set('before_id', String(params.before_id))
  if (params.limit !== undefined) sp.set('limit', String(params.limit))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export function useAllNotifications(params: AllNotificationsParams = {}) {
  return useQuery<NotificationRead[]>({
    queryKey: ['notifications', 'all', params],
    queryFn: () => api.get<NotificationRead[]>(`/notifications/${buildAllQuery(params)}`),
  })
}

export interface NotificationDelivery {
  user_id: string
  role: string
  read_at: string | null
}

export interface NotificationHistoryRead {
  id: number
  type: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  subject_type: string
  subject_id: string | null
  actor_id: string | null
  title: string
  body: string
  payload: Record<string, unknown>
  created_at: string
  recipients: NotificationDelivery[]
}

export interface ManualNotificationBody {
  title: string
  body: string
  user_ids?: string[]
  role?: 'manager' | 'superviser' | 'admin'
}

export function useSendManualNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ManualNotificationBody) => api.post<NotificationHistoryRead>('/notifications/', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'all'] })
    },
  })
}
