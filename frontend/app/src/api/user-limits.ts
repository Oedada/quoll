import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface LimitsUpdateBody {
  max_active_projects?: number | null
  max_subordinates?: number | null
}

export function useSetUserLimits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: LimitsUpdateBody }) =>
      api.patch(`/org/profiles/${userId}/limits`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['org'] })
    },
  })
}
