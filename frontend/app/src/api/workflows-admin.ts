// CRUD для маршрутов/шагов/переходов (Воркфлоу.dc.html, admin=true). Новый файл, чтобы не
// редактировать чужие workflows.ts/stages.ts/interactions.ts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { WorkflowRead } from './workflows'
import type { StageField, StageRead } from './stages'

export interface WorkflowCreateBody {
  name: string
  description?: string | null
  warn_days: number[]
}

export interface WorkflowUpdateBody {
  name?: string | null
  description?: string | null
  warn_days?: number[] | null
}

export interface StageCreateBody {
  name: string
  description?: string | null
  position?: number
  workflow_id: number
  is_terminal: boolean
  is_branch_stage?: boolean
  is_branch_start?: boolean
  is_side?: boolean
  handler?: string | null
  parent_stage_id?: number | null
  stall_days?: number | null
  passive_after_days?: number | null
  fields?: StageField[]
}

export interface StageUpdateBody {
  name?: string | null
  description?: string | null
  position?: number | null
  stall_days?: number | null
  passive_after_days?: number | null
  fields?: StageField[] | null
}

export interface StageHandlerRead {
  code: string
  label: string
}

export interface TransitionRead {
  id: number
  name: string
  workflow_id: number
  from_stage_id: number | null
  to_stage_id: number
  is_active: boolean
  comments: string | null
  requires_approval: boolean
  reject_to_stage_id: number | null
  is_backward: boolean
  is_irreversible: boolean
  required_document_kinds: string[]
  created_at: string
  updated_at: string
}

export interface TransitionCreateBody {
  name: string
  workflow_id: number
  from_stage_id?: number | null
  to_stage_id: number
  is_active?: boolean
  comments?: string | null
  requires_approval?: boolean
  reject_to_stage_id?: number | null
  is_backward?: boolean
  is_irreversible?: boolean
  required_document_kinds?: string[]
}

export interface TransitionUpdateBody {
  name?: string | null
  from_stage_id?: number | null
  to_stage_id?: number | null
  is_active?: boolean | null
  comments?: string | null
  requires_approval?: boolean | null
  reject_to_stage_id?: number | null
  is_backward?: boolean | null
  is_irreversible?: boolean | null
  required_document_kinds?: string[] | null
}

function invalidateWorkflow(qc: ReturnType<typeof useQueryClient>, workflowId?: number) {
  qc.invalidateQueries({ queryKey: ['workflows'] })
  if (workflowId != null) qc.invalidateQueries({ queryKey: ['stages', 'by-workflow', workflowId] })
  qc.invalidateQueries({ queryKey: ['transitions', 'available'] })
}

export function useCreateWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: WorkflowCreateBody) => api.post<WorkflowRead>('/workflows/', body),
    onSuccess: () => invalidateWorkflow(qc),
  })
}

export function useUpdateWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: WorkflowUpdateBody }) => api.patch<WorkflowRead>(`/workflows/${id}`, body),
    onSuccess: () => invalidateWorkflow(qc),
  })
}

export function useDeleteWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/workflows/${id}`),
    onSuccess: () => invalidateWorkflow(qc),
  })
}

export function usePublishWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/workflows/publish/${id}`),
    onSuccess: () => invalidateWorkflow(qc),
  })
}

export function useChangeStartStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ workflowId, stageId }: { workflowId: number; stageId: number }) =>
      api.post(`/workflows/${workflowId}/start-stage`, { stage_id: stageId }),
    onSuccess: (_data, { workflowId }) => invalidateWorkflow(qc, workflowId),
  })
}

export function useStageHandlers() {
  return useQuery<StageHandlerRead[]>({
    queryKey: ['stages', 'handlers'],
    queryFn: () => api.get<StageHandlerRead[]>('/stages/handlers'),
    staleTime: 10 * 60_000,
  })
}

export function useCreateStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: StageCreateBody) => api.post<StageRead>('/stages/', body),
    onSuccess: (_data, body) => invalidateWorkflow(qc, body.workflow_id),
  })
}

export function useUpdateStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: StageUpdateBody }) => api.patch<StageRead>(`/stages/${id}`, body),
    onSuccess: (data) => invalidateWorkflow(qc, data.workflow_id),
  })
}

export function useDeleteStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number; workflowId: number }) => api.delete<void>(`/stages/${id}`),
    onSuccess: (_data, { workflowId }) => invalidateWorkflow(qc, workflowId),
  })
}

export function useArchiveStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, relocateToStageId }: { id: number; relocateToStageId: number | null }) =>
      api.post<StageRead>(`/stages/${id}/archive`, { relocate_to_stage_id: relocateToStageId }),
    onSuccess: (data) => invalidateWorkflow(qc, data.workflow_id),
  })
}

export function useCreateTransition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TransitionCreateBody) => api.post<TransitionRead>('/transitions/', body),
    onSuccess: (_data, body) => invalidateWorkflow(qc, body.workflow_id),
  })
}

export function useUpdateTransition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TransitionUpdateBody }) => api.patch<TransitionRead>(`/transitions/${id}`, body),
    onSuccess: (data) => invalidateWorkflow(qc, data.workflow_id),
  })
}

export function useDeleteTransition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number; workflowId: number }) => api.delete<void>(`/transitions/${id}`),
    onSuccess: (_data, { workflowId }) => invalidateWorkflow(qc, workflowId),
  })
}
