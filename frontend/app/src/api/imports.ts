// Раздел «Импорт» (Импорт.dc.html, /api/v1/imports, только админ). Новый файл.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'

export interface FieldRead {
  key: string
  label: string
  type: string
  required: boolean
  contract: boolean
  group: boolean
  extra: boolean
  ignored: boolean
  description: string
  example: string
  synonyms: string[]
  enum_values: Record<string, string>
}

export interface KindRead {
  key: string
  label: string
  order: number
  fields: FieldRead[]
}

export interface HeaderRead {
  index: number
  title: string
  field: string | null
  note: string | null
}

export interface SheetIssue {
  code?: string
  level?: string
  field?: string | null
  [key: string]: unknown
}

export interface SheetRead {
  number: number
  name: string
  kind: string | null
  header_row: number
  headers: HeaderRead[]
  counts: Record<string, number>
  issues: SheetIssue[]
}

export interface BatchBrief {
  id: number
  filename: string
  file_format: string
  status: string
  version: number
  created_by: string | null
  created_at: string
  applied_at: string | null
  expires_at: string
}

export interface BatchSummary {
  sheets?: Record<string, Record<string, number>>
  statuses?: Record<string, number>
  progress?: { done: number; total: number }
  [key: string]: unknown
}

export interface BatchRead extends BatchBrief {
  workflow_id: number | null
  replace_stages: Record<string, number>
  summary: BatchSummary
  next_attempt_at: string | null
  sheets: SheetRead[]
}

export interface BatchPatchBody {
  workflow_id?: number | null
  replace_stages?: Record<string, number>
}

export interface SheetPatchBody {
  kind?: string | null
  mapping?: Record<string, string | null>
}

export interface ImportFileRead {
  id: number
  row_id: number
  attachment_id: number | null
  document_id: number | null
  filename: string | null
  kind: string
  stage_id: number | null
  title: string | null
  description: string | null
  contract_number: string | null
  contract_signed_at: string | null
  contract_valid_until: string | null
  created_at: string
}

export interface RowIssue {
  code: string
  level: string
  field: string | null
  params: Record<string, unknown>
}

export interface RowTarget {
  part: string
  kind: string
  action: string
  id?: number
  new_of_row?: number
  [key: string]: unknown
}

export interface RowRead {
  id: number
  sheet: number
  number: number
  status: string
  source: Record<string, string>
  edits: Record<string, unknown>
  values: Record<string, unknown>
  labels: Record<string, string>
  diff: Record<string, [unknown, unknown]>
  issues: RowIssue[]
  targets: RowTarget[]
  group_key: string | null
  decision: string | null
  manager_choice: string | null
  contacts_target: string | null
  excluded: boolean
  files: ImportFileRead[]
  result: string | null
  result_code: string | null
}

export interface RowsRead {
  total: number
  rows: RowRead[]
}

export interface RowPatchBody {
  edits?: Record<string, string | { id: number } | null>
  excluded?: boolean
  decision?: string | null
  manager_choice?: string
  contacts_target?: string
}

export interface DecisionRequestBody {
  decision: string
  group_keys?: string[]
  only_unresolved?: boolean
}

export interface ManagerRead {
  id: string
  name: string
  superviser: string | null
  status: string
}

export interface RowUpdateRead {
  rows: RowRead[]
  summary: BatchSummary
  version: number
}

export interface RowsQuery {
  sheet?: number
  status?: string[]
  group_key?: string
  has_issues?: boolean
  result?: string
  limit?: number
  offset?: number
}

function rowsQs(q: RowsQuery): string {
  const p = new URLSearchParams()
  if (q.sheet != null) p.set('sheet', String(q.sheet))
  if (q.status) q.status.forEach((s) => p.append('status', s))
  if (q.group_key != null) p.set('group_key', q.group_key)
  if (q.has_issues != null) p.set('has_issues', String(q.has_issues))
  if (q.result != null) p.set('result', q.result)
  p.set('limit', String(q.limit ?? 50))
  p.set('offset', String(q.offset ?? 0))
  return p.toString()
}

const BATCHES_KEY = ['imports', 'batches'] as const

export function useImportKinds(workflowId?: number | null) {
  return useQuery({
    queryKey: ['imports', 'kinds', workflowId ?? null],
    queryFn: () => api.get<KindRead[]>(`/imports/kinds${workflowId != null ? `?workflow_id=${workflowId}` : ''}`),
    staleTime: 5 * 60_000,
  })
}

export function useImportBatches(status: string | undefined, limit = 20, offset = 0) {
  return useQuery({
    queryKey: [...BATCHES_KEY, { status: status ?? null, limit, offset }],
    queryFn: () => {
      const p = new URLSearchParams()
      if (status) p.set('status', status)
      p.set('limit', String(limit))
      p.set('offset', String(offset))
      return api.get<BatchBrief[]>(`/imports/?${p.toString()}`)
    },
  })
}

export function useImportBatch(id: number | null) {
  return useQuery({
    queryKey: ['imports', 'batch', id],
    queryFn: () => api.get<BatchRead>(`/imports/${id}`),
    enabled: id != null,
    // опрос прогресса, пока применяется
    refetchInterval: (query) => (query.state.data?.status === 'APPLYING' ? 1500 : false),
  })
}

export function useUploadImport() {
  const qc = useQueryClient()
  return useMutation({
    // multipart: client.ts json-only, поэтому свой fetch
    mutationFn: async ({ file, workflowId }: { file: File; workflowId?: number | null }) => {
      const form = new FormData()
      form.append('file', file)
      if (workflowId != null) form.append('workflow_id', String(workflowId))
      const res = await fetch('/api/v1/imports/', { method: 'POST', credentials: 'include', body: form })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new ApiError(res.status, payload?.detail ?? payload)
      }
      return (await res.json()) as BatchRead
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: BATCHES_KEY }),
  })
}

export function usePatchBatch(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BatchPatchBody) => api.patch<BatchRead>(`/imports/${id}`, body),
    onSuccess: (data) => {
      qc.setQueryData(['imports', 'batch', id], data)
      qc.invalidateQueries({ queryKey: BATCHES_KEY })
    },
  })
}

export function usePatchSheet(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ number, body }: { number: number; body: SheetPatchBody }) =>
      api.patch<BatchRead>(`/imports/${id}/sheets/${number}`, body),
    onSuccess: (data) => qc.setQueryData(['imports', 'batch', id], data),
  })
}

export function useImportRows(id: number | null, query: RowsQuery) {
  return useQuery({
    queryKey: ['imports', 'rows', id, query],
    queryFn: () => api.get<RowsRead>(`/imports/${id}/rows?${rowsQs(query)}`),
    enabled: id != null,
  })
}

export function useImportRow(id: number | null, rowId: number | null) {
  return useQuery({
    queryKey: ['imports', 'row', id, rowId],
    queryFn: () => api.get<RowRead>(`/imports/${id}/rows/${rowId}`),
    enabled: id != null && rowId != null,
  })
}

function invalidateRows(qc: ReturnType<typeof useQueryClient>, id: number) {
  qc.invalidateQueries({ queryKey: ['imports', 'rows', id] })
  qc.invalidateQueries({ queryKey: ['imports', 'row', id] })
  qc.invalidateQueries({ queryKey: ['imports', 'batch', id] })
}

export function usePatchRow(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rowId, body }: { rowId: number; body: RowPatchBody }) =>
      api.patch<RowUpdateRead>(`/imports/${id}/rows/${rowId}`, body),
    onSuccess: () => invalidateRows(qc, id),
  })
}

export function useImportDecisions(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DecisionRequestBody) => api.post<BatchRead>(`/imports/${id}/decisions`, body),
    onSuccess: () => invalidateRows(qc, id),
  })
}

export function useImportManagers(id: number | null, q: string) {
  return useQuery({
    queryKey: ['imports', 'managers', id, q],
    queryFn: () => api.get<ManagerRead[]>(`/imports/${id}/managers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    enabled: id != null,
    staleTime: 30_000,
  })
}

export interface UploadRowFileInput {
  rowId: number
  file: File
  kind: string
  stage_id?: number | null
  title?: string
  description?: string
  contract_number?: string
  contract_signed_at?: string
  contract_valid_until?: string
}

export function useUploadRowFile(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UploadRowFileInput) => {
      const form = new FormData()
      form.append('file', input.file)
      form.append('kind', input.kind)
      if (input.stage_id != null) form.append('stage_id', String(input.stage_id))
      if (input.title) form.append('title', input.title)
      if (input.description) form.append('description', input.description)
      if (input.contract_number) form.append('contract_number', input.contract_number)
      if (input.contract_signed_at) form.append('contract_signed_at', input.contract_signed_at)
      if (input.contract_valid_until) form.append('contract_valid_until', input.contract_valid_until)
      const res = await fetch(`/api/v1/imports/${id}/rows/${input.rowId}/files`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new ApiError(res.status, payload?.detail ?? payload)
      }
      return (await res.json()) as ImportFileRead
    },
    onSuccess: () => invalidateRows(qc, id),
  })
}

export function useDeleteRowFile(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rowId, fileId }: { rowId: number; fileId: number }) => api.delete<void>(`/imports/${id}/rows/${rowId}/files/${fileId}`),
    onSuccess: () => invalidateRows(qc, id),
  })
}

export function useApplyBatch(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (version: number) => api.post<BatchRead>(`/imports/${id}/apply`, { version }),
    onSuccess: (data) => {
      qc.setQueryData(['imports', 'batch', id], data)
      qc.invalidateQueries({ queryKey: BATCHES_KEY })
    },
  })
}

export function useStopBatch(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<BatchRead>(`/imports/${id}/stop`),
    onSuccess: (data) => qc.setQueryData(['imports', 'batch', id], data),
  })
}

export function useCancelBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/imports/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: BATCHES_KEY }),
  })
}

export function importTemplateUrl(kinds: string[]): string {
  const p = new URLSearchParams()
  kinds.forEach((k) => p.append('kinds', k))
  const qs = p.toString()
  return `/api/v1/imports/template${qs ? `?${qs}` : ''}`
}

export function importReportUrl(batchId: number): string {
  return `/api/v1/imports/${batchId}/report`
}

// GET-скачивание: тот же источник, куки уходят с обычной навигацией по ссылке
export function triggerDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Не удалось выполнить действие'
}
