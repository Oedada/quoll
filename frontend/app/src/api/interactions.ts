import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Ref {
  id: number
  name: string
}
export interface PersonRef {
  id: string
  name: string
}
export interface BranchSummary {
  id: number
  program: Ref | null
  product: Ref | null
  vendor_name: string | null
  contract_status: string
}

export interface InteractionListRead {
  id: number
  university_id: number
  workflow_id: number | null
  state_id: number | null
  owner_id: string | null
  created_by: string | null
  pause_state: 'ACTIVE' | 'PAUSED' | string
  paused_until: string | null
  pause_comment: string | null
  status: string
  outcome: string | null
  slot: string
  stall_since: string | null
  planned_date: string | null
  signed_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  university: Ref
  responsible: PersonRef | null
  stage: Ref | null
  branches: BranchSummary[]
}

export interface InteractionListPage {
  total: number
  items: InteractionListRead[]
}

export interface InteractionListParams {
  university_id?: number
  status?: string[]
  responsible_id?: string
  stage_id?: number
  q?: string
  limit?: number
  offset?: number
}

function toQuery(params: object): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) v.forEach((x) => usp.append(k, String(x)))
    else usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

export function useInteractions(params: InteractionListParams) {
  return useQuery<InteractionListPage>({
    queryKey: ['interactions', params],
    queryFn: () => api.get<InteractionListPage>(`/interactions/${toQuery(params)}`),
  })
}

export interface InteractionRead {
  id: number
  university_id: number
  workflow_id: number | null
  state_id: number | null
  owner_id: string | null
  created_by: string | null
  pause_state: string
  paused_until: string | null
  pause_comment: string | null
  close_reason_id: number | null
  status: string
  outcome: string | null
  no_return_at: string | null
  slot: string
  stall_since: string | null
  warn_days: number[] | null
  planned_date: string | null
  signed_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export function useInteraction(id: number | undefined) {
  return useQuery<InteractionRead>({
    queryKey: ['interactions', 'detail', id],
    queryFn: () => api.get<InteractionRead>(`/interactions/${id}`),
    enabled: !!id,
  })
}

export interface HistoryStage {
  created_at: string
  kind: string
  from_stage_id: number | null
  to_stage_id: number
  actor_id: string | null
  comment: string | null
}
export interface HistoryAssignment {
  assigned_at: string
  released_at: string | null
  manager_id: string
  reason: string | null
}
export interface InteractionHistory {
  stages: HistoryStage[]
  assignments: HistoryAssignment[]
}

export function useInteractionHistory(id: number | undefined) {
  return useQuery<InteractionHistory>({
    queryKey: ['interactions', 'history', id],
    queryFn: () => api.get<InteractionHistory>(`/interactions/${id}/history`),
    enabled: !!id,
  })
}

export interface TransitionEdge {
  id: number
  workflow_id: number
  from_stage_id: number | null
  to_stage_id: number
  name: string
}

export function useAvailableTransitions(workflowId: number | undefined, fromStageId: number | null | undefined) {
  return useQuery<TransitionEdge[]>({
    queryKey: ['transitions', 'available', workflowId, fromStageId],
    queryFn: () =>
      api.get<TransitionEdge[]>(
        `/transitions/available${toQuery({ workflow_id: workflowId, from_stage_id: fromStageId ?? undefined })}`,
      ),
    enabled: !!workflowId,
  })
}

function useInteractionMutation<TBody>(action: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body?: TBody }) => api.post(`/interactions/${id}/${action}`, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['interactions'] })
      qc.invalidateQueries({ queryKey: ['interactions', 'detail', id] })
      qc.invalidateQueries({ queryKey: ['interactions', 'history', id] })
    },
  })
}

export const useAcceptInteraction = () =>
  useInteractionMutation<{ to_stage_id: number; comment?: string | null }>('accept')
export const useAssignInteraction = () =>
  useInteractionMutation<{ manager_id: string; expected_owner_id: string | null; reason?: string | null }>('assign')
export const useTransitionInteraction = () =>
  useInteractionMutation<{ to_stage_id: number; expected_state_id: number | null; comment?: string | null }>(
    'transition',
  )
export const useDeclineInteraction = () => useInteractionMutation<{ comment: string }>('decline')
export const usePauseInteraction = () =>
  useInteractionMutation<{ until: string | null; comment: string }>('pause')
export const useUnpauseInteraction = () => useInteractionMutation<undefined>('unpause')

export interface BranchWrite {
  program_id: number
  product_id: number | null
}

export interface InteractionCreateBody {
  university_id: number
  branches: BranchWrite[]
  planned_date?: string | null
  workflow_id?: number | null
}

export function useCreateInteractionDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InteractionCreateBody) => api.post<InteractionRead>('/interactions/', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interactions'] }),
  })
}
