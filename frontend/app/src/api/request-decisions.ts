import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { RequestRead } from './requests'

// решения руководителя по чужим просьбам - approve/reject нет среди готовых хуков requests.ts

export interface RequestApproveBody {
  target_manager_id?: string | null
  comment?: string | null
}

export interface RequestRejectBody {
  comment: string
}

export function useApproveRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RequestApproveBody }) =>
      api.post<RequestRead>(`/requests/${id}/approve`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  })
}

export function useRejectRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RequestRejectBody }) =>
      api.post<RequestRead>(`/requests/${id}/reject`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  })
}
