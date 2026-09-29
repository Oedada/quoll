// Хуки карточки взаимодействия руководителя: документы (+одобрение/отклонение), допсоглашения,
// побочные указатели, значения полей этапа (+одобрение/отклонение правки пройденного шага).
// Отдельный файл (не interaction-documents.ts в src/api/) - тот путь занят карточкой менеджера.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../client'
import type { AttachmentRead } from '../interaction-detail'

export interface DocumentRead {
  id: number
  interaction_id: number
  stage_id: number
  uploaded_by: string | null
  branch_id: number | null
  replaces_document_id: number | null
  title: string
  kind: string
  description: string | null
  contract_number: string | null
  contract_signed_at: string | null
  contract_valid_until: string | null
  supplementary_agreement_id: number | null
  side_pointer_id: number | null
  metadata: Record<string, unknown>
  is_current: boolean
  replaced_by_id: number | null
  replaced_on_stage_id: number | null
  status: 'ACTIVE' | 'PENDING' | 'REJECTED' | string
  created_at: string
  attachment: AttachmentRead | null
}

export function useDocuments(interactionId: number | undefined) {
  return useQuery<DocumentRead[]>({
    queryKey: ['interactions', 'documents', interactionId],
    queryFn: () => api.get<DocumentRead[]>(`/interactions/${interactionId}/documents`),
    enabled: !!interactionId,
  })
}

export interface UploadDocumentBody {
  file: File
  stage_id: number
  replaces_document_id?: number | null
  branch_id?: number | null
  side_pointer_id?: number | null
  title?: string
  kind?: string
  description?: string
  contract_number?: string
  contract_signed_at?: string
  contract_valid_until?: string
}

export function useUploadDocument(interactionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UploadDocumentBody) => {
      const fd = new FormData()
      fd.set('file', body.file)
      fd.set('stage_id', String(body.stage_id))
      if (body.replaces_document_id != null) fd.set('replaces_document_id', String(body.replaces_document_id))
      if (body.branch_id != null) fd.set('branch_id', String(body.branch_id))
      if (body.side_pointer_id != null) fd.set('side_pointer_id', String(body.side_pointer_id))
      if (body.title) fd.set('title', body.title)
      if (body.kind) fd.set('kind', body.kind)
      if (body.description) fd.set('description', body.description)
      if (body.contract_number) fd.set('contract_number', body.contract_number)
      if (body.contract_signed_at) fd.set('contract_signed_at', body.contract_signed_at)
      if (body.contract_valid_until) fd.set('contract_valid_until', body.contract_valid_until)
      const res = await fetch(`/api/v1/interactions/${interactionId}/documents`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new ApiError(res.status, payload?.detail ?? payload)
      }
      return res.json() as Promise<DocumentRead>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interactions', 'documents', interactionId] }),
  })
}

export function useApproveDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, comment }: { id: number; interactionId: number; comment?: string }) =>
      api.post<DocumentRead>(`/documents/${id}/approve`, { comment: comment ?? null }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['interactions', 'documents', vars.interactionId] }),
  })
}
export function useRejectDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, comment }: { id: number; interactionId: number; comment?: string }) =>
      api.post<DocumentRead>(`/documents/${id}/reject`, { comment: comment ?? null }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['interactions', 'documents', vars.interactionId] }),
  })
}

// --- Допсоглашения ---

export interface AgreementActionRead {
  id: number
  type: string
  branch_id: number | null
  program_id: number | null
  product_id: number | null
  license_until: string | null
  contract_valid_until: string | null
  result_branch_id: number | null
}
export interface AgreementRead {
  id: number
  interaction_id: number
  number: string | null
  signed_at: string | null
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'CANCELLED' | string
  created_by: string | null
  created_at: string
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
  side_pointer_id: number | null
  scan_document_id: number | null
  pending_request_id: number | null
  actions: AgreementActionRead[]
}

export function useAgreements(interactionId: number | undefined) {
  return useQuery<AgreementRead[]>({
    queryKey: ['interactions', 'agreements', interactionId],
    queryFn: () => api.get<AgreementRead[]>(`/interactions/${interactionId}/supplementary-agreements`),
    enabled: !!interactionId,
  })
}

// --- Побочные указатели ---

export interface SidePointerRead {
  id: number
  interaction_id: number
  branch_id: number | null
  entry_stage_id: number
  stage_id: number
  status: 'ACTIVE' | 'FINISHED' | 'CANCELLED' | string
  started_by: string | null
  started_at: string
  finished_by: string | null
  finished_at: string | null
  finish_comment: string | null
}

export function useSidePointers(interactionId: number | undefined) {
  return useQuery<SidePointerRead[]>({
    queryKey: ['interactions', 'side-pointers', interactionId],
    queryFn: () => api.get<SidePointerRead[]>(`/interactions/${interactionId}/side-pointers`),
    enabled: !!interactionId,
  })
}

// --- Значения полей этапа ---

export interface StageValuesRead {
  stage_id: number
  branch_id: number | null
  side_pointer_id: number | null
  values: Record<string, unknown>
  updated_by: string | null
  updated_at: string
  // правка пройденного шага на одобрении у руководителя
  pending_values: Record<string, unknown> | null
  pending_by: string | null
}

export function useStageValuesList(interactionId: number | undefined) {
  return useQuery<StageValuesRead[]>({
    queryKey: ['interactions', 'stage-values', interactionId],
    queryFn: () => api.get<StageValuesRead[]>(`/interactions/${interactionId}/stage-values`),
    enabled: !!interactionId,
  })
}

// руководитель применяет ("Supervisor applies a pending edit of a passed step") или отклоняет
// предложенную КАМом правку пройденного шага
function useStageValuesDecision(kind: 'approve' | 'reject') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      interactionId,
      stageId,
      branchId,
      sidePointerId,
    }: {
      interactionId: number
      stageId: number
      branchId?: number | null
      sidePointerId?: number | null
    }) => {
      const params = new URLSearchParams()
      if (branchId != null) params.set('branch_id', String(branchId))
      if (sidePointerId != null) params.set('side_pointer_id', String(sidePointerId))
      const qs = params.toString()
      return api.post<StageValuesRead>(
        `/interactions/${interactionId}/stage-values/${stageId}/${kind}${qs ? `?${qs}` : ''}`,
      )
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['interactions', 'stage-values', vars.interactionId] }),
  })
}
export const useApproveStageValues = () => useStageValuesDecision('approve')
export const useRejectStageValues = () => useStageValuesDecision('reject')
