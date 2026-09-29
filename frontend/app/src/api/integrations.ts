import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'

// Отдельный файл — не трогаем чужие src/api/*.ts, где параллельно работают другие агенты.

export type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface ProposalRead {
  id: number
  kind: string
  university_id: number
  program_id: number
  reason: string
  status: ProposalStatus
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
  workflow_id: number | null
  result_interaction_id: number | null
  created_at: string
}

export function useProposals(status: ProposalStatus | null = 'PENDING') {
  return useQuery<ProposalRead[]>({
    queryKey: ['integrations', 'proposals', status],
    queryFn: () =>
      api.get<ProposalRead[]>(`/integrations/proposals?limit=200${status ? `&status=${status}` : ''}`),
  })
}

export interface ProposalApproveBody {
  workflow_id: number | null
  comment: string | null
}

export interface ProposalRejectBody {
  comment: string
}

export function useApproveProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ProposalApproveBody }) =>
      api.post<ProposalRead>(`/integrations/proposals/${id}/approve`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'proposals'] }),
  })
}

export function useRejectProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ProposalRejectBody }) =>
      api.post<ProposalRead>(`/integrations/proposals/${id}/reject`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'proposals'] }),
  })
}

// запуски интеграционных потоков — для "Сводки здоровья" и раздела "Интеграции"
export type RunFlow = 'I2' | 'I1' | 'B1' | 'B2'
export type RunStatus = 'DONE' | 'FAILED'

export interface RunRead {
  id: number
  flow: RunFlow
  trigger: string
  status: RunStatus
  started_at: string
  finished_at: string
  counters: Record<string, number>
  error: string | null
  actor_id: string | null
}

export function useIntegrationRuns(limit = 8) {
  return useQuery<RunRead[]>({
    queryKey: ['integrations', 'runs', limit],
    queryFn: () => api.get<RunRead[]>(`/integrations/runs?limit=${limit}`),
  })
}

// раздел "Интеграции" (только админ) — вкладки "Потоки и запуски", "Несопоставленные", "Выгрузка", "Статистика LMS"

export function useRuns(flow: RunFlow | '' = '', limit = 50) {
  return useQuery<RunRead[]>({
    queryKey: ['integrations', 'runs-list', flow, limit],
    queryFn: () => api.get<RunRead[]>(`/integrations/runs?limit=${limit}${flow ? `&flow=${flow}` : ''}`),
  })
}

export function useStartRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (flow: RunFlow) => api.post<RunRead>(`/integrations/runs/${flow}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations', 'runs-list'] })
      qc.invalidateQueries({ queryKey: ['integrations', 'runs'] })
      qc.invalidateQueries({ queryKey: ['integrations', 'stub'] })
    },
  })
}

export function useUploadRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ flow, file }: { flow: 'B1' | 'B2'; file: File }) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/v1/integrations/upload/${flow}`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new ApiError(res.status, payload?.detail ?? payload)
      return payload as RunRead
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations', 'runs-list'] })
      qc.invalidateQueries({ queryKey: ['integrations', 'runs'] })
    },
  })
}

export interface StubRead {
  flow: string
  received_at: string | null
  payload: Record<string, unknown>[] | null
}

export function useStub(flow: 'I1' | 'I2' | null) {
  return useQuery<StubRead>({
    queryKey: ['integrations', 'stub', flow],
    queryFn: () => api.get<StubRead>(`/integrations/stub/${flow}`),
    enabled: !!flow,
  })
}

export type UnmatchedStatus = 'PENDING' | 'RESOLVED' | 'REJECTED'

export interface UnmatchedRead {
  id: number
  flow: string
  record_key: string
  code: string
  mapping_kind: string
  external_key: string
  record: Record<string, unknown>
  candidates: number[]
  status: UnmatchedStatus
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export function useUnmatched(status: UnmatchedStatus | null = 'PENDING', limit = 100) {
  return useQuery<UnmatchedRead[]>({
    queryKey: ['integrations', 'unmatched', status, limit],
    queryFn: () => api.get<UnmatchedRead[]>(`/integrations/unmatched?limit=${limit}${status ? `&status=${status}` : ''}`),
  })
}

export function useResolveUnmatched() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number }) =>
      api.post<UnmatchedRead[]>(`/integrations/unmatched/${id}/resolve`, { target_id: targetId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'unmatched'] }),
  })
}

export function useRejectUnmatched() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<UnmatchedRead>(`/integrations/unmatched/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'unmatched'] }),
  })
}

export interface LmsStatsRead {
  university_id: number
  program_id: number
  students: number
  streams: number
  teachers_trained: number | null
  source: string
  updated_at: string
}

export function useLmsStats(universityId?: number, programId?: number) {
  return useQuery<LmsStatsRead[]>({
    queryKey: ['integrations', 'lms-stats', universityId ?? null, programId ?? null],
    queryFn: () => {
      const params = new URLSearchParams()
      if (universityId) params.set('university_id', String(universityId))
      if (programId) params.set('program_id', String(programId))
      const qs = params.toString()
      return api.get<LmsStatsRead[]>(`/integrations/lms-stats${qs ? `?${qs}` : ''}`)
    },
  })
}

// скачивание файла выгрузки — не JSON-ответ, поэтому мимо api.get
export async function exportIntegrations(params: { universityIds: number[]; programIds: number[]; includeClosed: boolean }) {
  const q = new URLSearchParams()
  params.universityIds.forEach((id) => q.append('university_ids', String(id)))
  params.programIds.forEach((id) => q.append('program_ids', String(id)))
  q.set('include_closed', String(params.includeClosed))
  const res = await fetch(`/api/v1/integrations/export?${q.toString()}`, { method: 'GET', credentials: 'include' })
  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    throw new ApiError(res.status, payload?.detail ?? payload)
  }
  const disposition = res.headers.get('content-disposition') ?? ''
  const match = /filename="?([^"]+)"?/.exec(disposition)
  const filename = match ? match[1] : 'export.json'
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return filename
}
