import { useQuery } from '@tanstack/react-query'
import { api } from './client'

// справочники для экрана "Просьбы": причины закрытия и одиночный этап по id -
// не заводим заново, но их не было среди готовых хуков (requests.ts/stages.ts)

export type CloseReasonLevel = 'INTERACTION_BEFORE_SIGNING' | 'INTERACTION_AFTER_SIGNING' | 'BRANCH'

export interface CloseReasonRead {
  id: number
  code: string
  label: string
  level: CloseReasonLevel
  outcome: 'DONE' | 'REFUSED'
  needs_comment: boolean
  is_system: boolean
}

export function useCloseReasons(level?: CloseReasonLevel, enabled = true) {
  return useQuery<CloseReasonRead[]>({
    queryKey: ['catalog', 'close-reasons', level ?? 'all'],
    queryFn: () => api.get<CloseReasonRead[]>(`/catalog/close-reasons${level ? `?level=${level}` : ''}`),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export interface StageDetail {
  id: number
  workflow_id: number
  name: string
  is_terminal: boolean
}

export function useStage(stageId: number | null | undefined) {
  return useQuery<StageDetail>({
    queryKey: ['stages', 'detail', stageId],
    queryFn: () => api.get<StageDetail>(`/stages/${stageId}`),
    enabled: !!stageId,
    staleTime: 5 * 60_000,
  })
}
