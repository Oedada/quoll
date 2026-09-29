// Хуки для карточки взаимодействия: документы шага, допсоглашения, side-pointers,
// значения полей шага (stage-values). Новый файл, чтобы не трогать interaction-detail.ts
// и interaction-settings.ts, занятые другой логикой карточки.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'
import type { AttachmentRead } from './interaction-detail'

// --- Документы

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

export interface UploadDocumentInput {
  interactionId: number
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

export function useUploadDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UploadDocumentInput) => {
      const fd = new FormData()
      fd.set('file', input.file)
      fd.set('stage_id', String(input.stage_id))
      if (input.replaces_document_id != null) fd.set('replaces_document_id', String(input.replaces_document_id))
      if (input.branch_id != null) fd.set('branch_id', String(input.branch_id))
      if (input.side_pointer_id != null) fd.set('side_pointer_id', String(input.side_pointer_id))
      if (input.title) fd.set('title', input.title)
      if (input.kind) fd.set('kind', input.kind)
      if (input.description) fd.set('description', input.description)
      if (input.contract_number) fd.set('contract_number', input.contract_number)
      if (input.contract_signed_at) fd.set('contract_signed_at', input.contract_signed_at)
      if (input.contract_valid_until) fd.set('contract_valid_until', input.contract_valid_until)
      const res = await fetch(`/api/v1/interactions/${input.interactionId}/documents`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new ApiError(res.status, payload?.detail ?? payload)
      }
      return (await res.json()) as DocumentRead
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'documents', vars.interactionId] })
    },
  })
}

function useDocumentDecision(action: 'approve' | 'reject') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, comment }: { interactionId: number; documentId: number; comment?: string }) =>
      api.post<DocumentRead>(`/documents/${documentId}/${action}`, { comment: comment ?? null }),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'documents', interactionId] })
    },
  })
}
export const useApproveDocument = () => useDocumentDecision('approve')
export const useRejectDocument = () => useDocumentDecision('reject')

// --- Допсоглашения

export interface AgreementActionRead {
  id: number
  type: 'NEW_BRANCH' | 'EXTEND_LICENSE' | 'RESUME' | 'EXCLUDE' | 'EXTEND_CONTRACT' | string
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
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'RETURNED' | string
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

export function useUpdateAgreement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ interactionId, saId, body }: { interactionId: number; saId: number; body: { number?: string | null; signed_at?: string | null } }) =>
      api.patch<AgreementRead>(`/interactions/${interactionId}/supplementary-agreements/${saId}`, body),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'agreements', interactionId] })
    },
  })
}

export interface AgreementActionWrite {
  type: 'NEW_BRANCH' | 'EXTEND_LICENSE' | 'RESUME' | 'EXCLUDE' | 'EXTEND_CONTRACT'
  branch_id?: number | null
  program_id?: number | null
  product_id?: number | null
  license_until?: string | null
  contract_valid_until?: string | null
}

export function useAddAgreementAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ interactionId, saId, body }: { interactionId: number; saId: number; body: AgreementActionWrite }) =>
      api.post<AgreementActionRead>(`/interactions/${interactionId}/supplementary-agreements/${saId}/actions`, body),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'agreements', interactionId] })
    },
  })
}

export function useRemoveAgreementAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ interactionId, saId, actionId }: { interactionId: number; saId: number; actionId: number }) =>
      api.delete(`/interactions/${interactionId}/supplementary-agreements/${saId}/actions/${actionId}`),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'agreements', interactionId] })
    },
  })
}

export function useUploadAgreementScan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      interactionId,
      saId,
      file,
      replaces_document_id,
    }: {
      interactionId: number
      saId: number
      file: File
      replaces_document_id?: number | null
    }) => {
      const fd = new FormData()
      fd.set('file', file)
      if (replaces_document_id != null) fd.set('replaces_document_id', String(replaces_document_id))
      const res = await fetch(`/api/v1/interactions/${interactionId}/supplementary-agreements/${saId}/scan`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new ApiError(res.status, payload?.detail ?? payload)
      }
      return (await res.json()) as DocumentRead
    },
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'agreements', interactionId] })
      qc.invalidateQueries({ queryKey: ['interactions', 'documents', interactionId] })
    },
  })
}

// --- Side-pointers (допсоглашение запускается как side-pointer на шаг-обработчик)

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

export function useStartSidePointer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ interactionId, stage_id, comment }: { interactionId: number; stage_id: number; comment?: string | null }) =>
      api.post<SidePointerRead>(`/interactions/${interactionId}/side-pointers`, { stage_id, comment: comment ?? null }),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'side-pointers', interactionId] })
      qc.invalidateQueries({ queryKey: ['interactions', 'agreements', interactionId] })
      qc.invalidateQueries({ queryKey: ['interactions', 'detail', interactionId] })
    },
  })
}

export function useTransitionSidePointer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      interactionId,
      pointerId,
      to_stage_id,
      expected_state_id,
      comment,
    }: {
      interactionId: number
      pointerId: number
      to_stage_id: number
      expected_state_id: number | null
      comment?: string | null
    }) =>
      api.post<SidePointerRead>(`/interactions/${interactionId}/side-pointers/${pointerId}/transition`, {
        to_stage_id,
        expected_state_id,
        comment: comment ?? null,
      }),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'side-pointers', interactionId] })
      qc.invalidateQueries({ queryKey: ['interactions', 'agreements', interactionId] })
    },
  })
}

export function useCancelSidePointer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ interactionId, pointerId, comment }: { interactionId: number; pointerId: number; comment?: string | null }) =>
      api.post<SidePointerRead>(`/interactions/${interactionId}/side-pointers/${pointerId}/cancel`, { comment: comment ?? null }),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'side-pointers', interactionId] })
      qc.invalidateQueries({ queryKey: ['interactions', 'agreements', interactionId] })
      qc.invalidateQueries({ queryKey: ['interactions', 'detail', interactionId] })
    },
  })
}

// --- Значения полей шага (stage-values)

export interface StageValuesRead {
  stage_id: number
  branch_id: number | null
  side_pointer_id: number | null
  values: Record<string, unknown>
  updated_by: string | null
  updated_at: string
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

export function useSetStageValues() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      interactionId,
      stageId,
      values,
      branchId,
      sidePointerId,
    }: {
      interactionId: number
      stageId: number
      values: Record<string, unknown>
      branchId?: number | null
      sidePointerId?: number | null
    }) => {
      const qs = new URLSearchParams()
      if (branchId != null) qs.set('branch_id', String(branchId))
      if (sidePointerId != null) qs.set('side_pointer_id', String(sidePointerId))
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      return api.put<StageValuesRead>(`/interactions/${interactionId}/stage-values/${stageId}${suffix}`, { values })
    },
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'stage-values', interactionId] })
    },
  })
}

function useStageValuesDecision(action: 'approve' | 'reject') {
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
      const qs = new URLSearchParams()
      if (branchId != null) qs.set('branch_id', String(branchId))
      if (sidePointerId != null) qs.set('side_pointer_id', String(sidePointerId))
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      return api.post<StageValuesRead>(`/interactions/${interactionId}/stage-values/${stageId}/${action}${suffix}`)
    },
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'stage-values', interactionId] })
    },
  })
}
export const useApproveStageValues = () => useStageValuesDecision('approve')
export const useRejectStageValues = () => useStageValuesDecision('reject')
