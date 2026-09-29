import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface OptionRead {
  id: number | string
  name: string
}

export interface PersonOptionRead extends OptionRead {
  is_active: boolean
}

export interface StageOptionRead extends OptionRead {
  archived?: boolean
}

export interface OptionsRead {
  universities: OptionRead[]
  regions: string[]
  directions: OptionRead[]
  programs: OptionRead[]
  products: OptionRead[]
  responsible: PersonOptionRead[]
  statuses: StageOptionRead[]
}

export function useReportOptions() {
  return useQuery<OptionsRead>({
    queryKey: ['reports', 'options'],
    queryFn: () => api.get<OptionsRead>('/reports/options'),
    staleTime: 60_000,
  })
}

export type ReportColumn =
  | 'university'
  | 'direction'
  | 'program'
  | 'product'
  | 'status'
  | 'responsible'
  | 'students'
  | 'streams'
  | 'teachers_kam'
  | 'teachers_lms'
  | 'transitions'
  | 'contract_number'
  | 'license_until'
  | 'transfer_status'
  | 'region'

// параметры отчёта - общие для предпросмотра (+offset/limit) и файла (снимок для очереди)
export interface ReportParams {
  date_from?: string | null
  date_to?: string | null
  university_ids?: number[]
  regions?: string[]
  direction_ids?: number[]
  program_ids?: number[]
  product_ids?: (number | 'none')[]
  responsible_ids?: string[]
  statuses?: (number | 'AWAITING' | 'DONE' | 'REFUSED')[]
  columns?: ReportColumn[]
}

export interface PreviewRequest extends ReportParams {
  offset?: number
  limit?: number
}

export interface StatusReadValue {
  kind: 'AWAITING' | 'STEP' | 'DONE' | 'REFUSED'
  stage_id: number | null
  stage_name: string | null
  archived: boolean
  paused: boolean
  agreement: boolean
  label: string
}

export interface ResponsibleReadValue {
  id: string | null
  name: string
  earlier_id: string | null
  earlier_name: string | null
  label: string
}

export interface MoveRead {
  at: string
  kind: 'MOVE' | 'PAUSE' | 'UNPAUSE' | 'CLOSE' | 'REOPEN' | 'IMPORT'
  from_stage_id: number | null
  to_stage_id: number | null
  label: string
}

export interface TransitionsReadValue {
  count: number
  items: MoveRead[]
}

// в ответе есть только выбранные колонки - остальные поля отсутствуют
export interface RowRead {
  interaction_id: number
  branch_id: number | null
  university_id: number
  university?: string | null
  direction?: string | null
  program?: string | null
  product?: string | null
  status?: StatusReadValue | null
  responsible?: ResponsibleReadValue | null
  students?: number | null
  streams?: number | null
  teachers_kam?: number | null
  teachers_lms?: number | null
  transitions?: TransitionsReadValue | null
  contract_number?: string | null
  license_until?: string | null
  transfer_status?: string | null
  region?: string | null
}

export interface PreviewRead {
  total: number
  columns: ReportColumn[]
  rows: RowRead[]
}

export function useReportPreview() {
  return useMutation({
    mutationFn: (body: PreviewRequest) => api.post<PreviewRead>('/reports/preview', body),
  })
}

export type ExportFormat = 'xlsx' | 'xls' | 'pdf'

export interface ExportCreate {
  params: ReportParams
  format: ExportFormat
}

export type ExportStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'TIMED_OUT' | 'EXPIRED'

export interface ExportRead {
  id: number
  status: ExportStatus
  format: ExportFormat
  row_count: number | null
  created_at: string
  finished_at: string | null
  file_name: string
  code: string | null
  position: number | null
}

export function useCreateReportExport() {
  return useMutation({
    mutationFn: (body: ExportCreate) => api.post<ExportRead>('/reports/exports', body),
  })
}

const FINAL_EXPORT_STATUSES: ExportStatus[] = ['DONE', 'FAILED', 'TIMED_OUT', 'EXPIRED']

// опрос статуса, пока задание не дойдёт до финального состояния
export function useReportExport(id: number | null) {
  return useQuery<ExportRead>({
    queryKey: ['reports', 'exports', id],
    queryFn: () => api.get<ExportRead>(`/reports/exports/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && FINAL_EXPORT_STATUSES.includes(status) ? false : 1200
    },
  })
}

// отдаётся как поток с Content-Disposition: attachment - обычная навигация скачает файл,
// куки сессии уйдут вместе с запросом, т.к. путь тот же источник
export function reportExportFileUrl(id: number): string {
  return `/api/v1/reports/exports/${id}/file`
}
