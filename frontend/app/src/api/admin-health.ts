// Сводка здоровья системы для администратора. Отдельный файл — не трогаем чужие src/api/*.ts.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface HealthRead {
  failed_tasks: number
  tasks_waiting_over_3_days: number
  interactions_waiting_capacity_over_a_day: number
  managers_without_supervisor_with_work: number
  capable_supervisers: number
  capable_admins: number
}

export function useHealthChecks() {
  return useQuery<HealthRead>({
    queryKey: ['admin', 'health-checks'],
    queryFn: () => api.get<HealthRead>('/admin/health-checks'),
  })
}
