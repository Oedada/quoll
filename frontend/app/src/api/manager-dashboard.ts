// Хуки для "Рабочего стола" менеджера. Отдельный файл, чтобы не конфликтовать
// с другими агентами, параллельно правящими src/api/interactions.ts.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { InteractionListPage } from './interactions'

export interface StageCount {
  stage_id: number
  name: string
  count: number
}

export interface InteractionStatsRead {
  by_status: Record<string, number>
  by_stage: StageCount[]
  incoming: number
  pending_requests: number
}

export function useInteractionStats() {
  return useQuery<InteractionStatsRead>({
    queryKey: ['interactions', 'stats'],
    queryFn: () => api.get<InteractionStatsRead>('/interactions/stats'),
  })
}

// GET /interactions/?slot=PASSIVE — счётчик пассивных заявок ответственного.
// Отдельный запрос, т.к. useInteractions() из interactions.ts не принимает slot.
export function usePassiveCount(responsibleId: string | undefined) {
  return useQuery<number>({
    queryKey: ['interactions', 'passive-count', responsibleId],
    queryFn: async () => {
      const page = await api.get<InteractionListPage>(
        `/interactions/?responsible_id=${responsibleId}&slot=PASSIVE&limit=1`,
      )
      return page.total
    },
    enabled: !!responsibleId,
  })
}
