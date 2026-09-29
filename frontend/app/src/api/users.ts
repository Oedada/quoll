import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { UserRead, UserRole } from './types'

export interface UserListRead {
  users: UserRead[]
  total: number
  limit: number
  offset: number
}

export interface UsersListParams {
  role?: UserRole
  is_active?: boolean
  q?: string
  limit?: number
  offset?: number
}

function buildQuery(params: UsersListParams): string {
  const sp = new URLSearchParams()
  if (params.role) sp.set('role', params.role)
  if (params.is_active !== undefined) sp.set('is_active', String(params.is_active))
  if (params.q) sp.set('q', params.q)
  if (params.limit !== undefined) sp.set('limit', String(params.limit))
  if (params.offset !== undefined) sp.set('offset', String(params.offset))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export function useUsers(params: UsersListParams) {
  return useQuery<UserListRead>({
    queryKey: ['users', params],
    queryFn: () => api.get<UserListRead>(`/users/${buildQuery(params)}`),
  })
}

export interface UserCreateBody {
  username: string
  email: string
  first_name?: string
  last_name?: string
  patronymic: string
  password: string
  role?: UserRole
}

function invalidateUsers(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['users'] })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserCreateBody) => api.post<UserRead>('/users/', body),
    onSuccess: () => invalidateUsers(qc),
  })
}

export interface UserUpdateBody {
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  patronymic?: string | null
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserUpdateBody }) => api.patch<UserRead>(`/users/${id}`, body),
    onSuccess: () => invalidateUsers(qc),
  })
}

// 200 - роль сменилась сразу, 202 - учётка заблокирована, смена роли поставлена в очередь
export function useChangeRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => api.patch(`/users/${id}/role`, { role }),
    onSuccess: () => invalidateUsers(qc),
  })
}

export function useDeactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/deactivate`),
    onSuccess: () => invalidateUsers(qc),
  })
}

export function useReactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/reactivate`),
    onSuccess: () => invalidateUsers(qc),
  })
}
