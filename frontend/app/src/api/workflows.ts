import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface WorkflowRead {
  id: number
  name: string
  description: string | null
  warn_days: number[]
  is_published: boolean
  created_at: string
  updated_at: string
}

export function useWorkflows() {
  return useQuery<WorkflowRead[]>({
    queryKey: ['workflows'],
    queryFn: () => api.get<WorkflowRead[]>('/workflows/?limit=100'),
    staleTime: 60_000,
  })
}
