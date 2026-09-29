// PATCH /interactions/{id}/settings — пороги застоя и предупреждений руководителя для одной
// заявки (InteractionSettings). Новый файл, чтобы не редактировать чужой interactions.ts.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { InteractionRead } from './interactions'

export interface InteractionSettingsBody {
  stall_overrides?: Record<number, number | null> | null
  warn_days?: number[] | null
}

export function useUpdateInteractionSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: InteractionSettingsBody }) =>
      api.patch<InteractionRead>(`/interactions/${id}/settings`, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['interactions'] })
      qc.invalidateQueries({ queryKey: ['interactions', 'detail', id] })
    },
  })
}

// PATCH /interactions/{id} — только university_id/planned_date (InteractionUpdate);
// «Изменить» у плановой даты в блоке «Сведения» карточки.
export function useUpdatePlannedDate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, planned_date }: { id: number; planned_date: string | null }) =>
      api.patch<InteractionRead>(`/interactions/${id}`, { planned_date }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['interactions'] })
      qc.invalidateQueries({ queryKey: ['interactions', 'detail', id] })
    },
  })
}
