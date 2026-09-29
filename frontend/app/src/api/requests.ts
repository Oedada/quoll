import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export type RequestKind = 'TRANSFER' | 'CLOSE' | 'TRANSITION'

export interface RequestRead {
  id: number
  interaction_id: number
  kind: RequestKind
  status: string
  requested_by: string | null
  from_owner_id: string | null
  target_stage_id: number | null
  target_manager_id: string | null
  transition_id: number | null
  branch_id: number | null
  close_reason_id: number | null
  branch_close_reason_id: number | null
  side_pointer_id: number | null
  reason: string
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
  created_at: string
}

export interface RequestCreate {
  kind: RequestKind
  branch_id?: number | null
  target_stage_id?: number | null
  target_manager_id?: string | null
  close_reason_id?: number | null
  branch_close_reason_id?: number | null
  side_pointer_id?: number | null
  reason: string
}

export function useRequests(interactionId?: number) {
  return useQuery<RequestRead[]>({
    queryKey: ['requests', interactionId ?? 'all'],
    queryFn: () =>
      api.get<RequestRead[]>(`/requests/${interactionId ? `?interaction_id=${interactionId}` : ''}`),
  })
}

export function useCreateRequest(interactionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: RequestCreate) => api.post<RequestRead>(`/interactions/${interactionId}/requests`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  })
}

export function useDeleteRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/requests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  })
}
