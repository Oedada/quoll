import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface StageField {
  key: string
  label: string
  type: string
  required: boolean
}

export interface StageRead {
  id: number
  workflow_id: number
  name: string
  description: string | null
  position: number
  is_terminal: boolean
  is_branch_stage: boolean
  is_branch_start: boolean
  is_side: boolean
  handler: string | null
  parent_stage_id: number | null
  stall_days: number | null
  passive_after_days: number | null
  fields: StageField[]
  archived_at: string | null
}

export function useStagesByWorkflow(workflowId: number | null | undefined) {
  return useQuery<StageRead[]>({
    queryKey: ['stages', 'by-workflow', workflowId],
    queryFn: () => api.get<StageRead[]>(`/stages/by-workflow/${workflowId}`),
    enabled: !!workflowId,
    staleTime: 5 * 60_000,
  })
}
