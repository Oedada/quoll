// Хуки для карточки взаимодействия (InteractionCardPage), которых нет в interactions.ts:
// ветки, комментарии к шагу. Новый файл, чтобы не конфликтовать с другими агентами.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface UniversityFull {
  id: number
  full_name: string
  short_name: string
  inn: string
  kpp: string | null
  site: string | null
  region: string
  city: string
}
export interface StageFull {
  id: number
  workflow_id: number
  name: string
  is_terminal: boolean
}
export interface WorkflowRead {
  id: number
  name: string
}
// GET /interactions/{id} в реальности отдаёт InteractionDetailRead (шире, чем InteractionRead
// в interactions.ts) - университет и текущий шаг с названиями. Поля читаем через этот тип поверх
// объекта, который вернул useInteraction (тот же запрос, тот же ответ сервера).
export interface InteractionDetailExtra {
  university: UniversityFull
  workflow: WorkflowRead | null
  state: StageFull | null
}

export interface BranchRead {
  id: number
  interaction_id: number
  program_id: number | null
  product_id: number | null
  contract_status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | string
  origin: string
  supplementary_agreement_id: number | null
  iteration: number
  state_id: number | null
  opened_at: string | null
  closed_at: string | null
  close_reason_id: number | null
  stall_since: string | null
  pause_state: 'ACTIVE' | 'PAUSED' | string
  paused_until: string | null
  pause_comment: string | null
  license_signed_at: string | null
  license_term_years: number | null
  license_until: string | null
  transfer_status: string
  teachers_trained: number | null
  added_by: string | null
  created_at: string
}

export function useBranches(interactionId: number | undefined) {
  return useQuery<BranchRead[]>({
    queryKey: ['interactions', 'branches', interactionId],
    queryFn: () => api.get<BranchRead[]>(`/interactions/${interactionId}/branches`),
    enabled: !!interactionId,
  })
}

function useBranchMutation<TBody>(action: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ interactionId, branchId, body }: { interactionId: number; branchId: number; body?: TBody }) =>
      api.post(`/interactions/${interactionId}/branches/${branchId}/${action}`, body),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'branches', interactionId] })
      qc.invalidateQueries({ queryKey: ['interactions', 'history', interactionId] })
    },
  })
}

export const usePauseBranch = () => useBranchMutation<{ until: string | null; comment: string }>('pause')
export const useUnpauseBranch = () => useBranchMutation<undefined>('unpause')
export const useCloseBranch = () => useBranchMutation<{ close_reason_id: number; comment?: string | null }>('close')

export function useSetBranchContractStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      interactionId,
      branchId,
      contract_status,
    }: {
      interactionId: number
      branchId: number
      contract_status: 'PROPOSED' | 'APPROVED' | 'REJECTED'
    }) => api.patch<BranchRead>(`/interactions/${interactionId}/branches/${branchId}`, { contract_status }),
    onSuccess: (_data, { interactionId }) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'branches', interactionId] })
    },
  })
}

export interface AuthorRead {
  id: string | null
  name: string
}
export interface AttachmentRead {
  id: number
  filename: string
  mime_type: string
  size_bytes: number
  title: string | null
}
export interface ReplyPreview {
  id: number
  author_name: string
  text_preview: string | null
  deleted: boolean
}
export interface CommentRead {
  id: number
  interaction_id: number
  stage_id: number
  branch_id: number | null
  side_pointer_id: number | null
  author: AuthorRead
  text: string | null
  reply_to: ReplyPreview | null
  attachments: AttachmentRead[]
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  deleted: boolean
}
export interface CommentListRead {
  total: number
  items: CommentRead[]
}

export function useComments(interactionId: number | undefined, stageId: number | undefined | null) {
  return useQuery<CommentListRead>({
    queryKey: ['interactions', 'comments', interactionId, stageId],
    queryFn: () => api.get<CommentListRead>(`/interactions/${interactionId}/comments?stage_id=${stageId}`),
    enabled: !!interactionId && !!stageId,
  })
}

// POST принимает multipart/form-data (там же можно приложить файлы) - для простого текстового
// комментария без вложений формируем FormData и шлём через fetch напрямую (api.post шлёт JSON).
export function useCreateComment(interactionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { stage_id: number; text: string; reply_to_id?: number | null; notify_supervisor?: boolean }) => {
      const fd = new FormData()
      fd.set('stage_id', String(body.stage_id))
      fd.set('text', body.text)
      if (body.reply_to_id != null) fd.set('reply_to_id', String(body.reply_to_id))
      fd.set('notify_supervisor', String(!!body.notify_supervisor))
      const res = await fetch(`/api/v1/interactions/${interactionId}/comments`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      if (!res.ok) throw new Error('Не удалось отправить комментарий')
      return res.json() as Promise<CommentRead>
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['interactions', 'comments', interactionId, vars.stage_id] })
    },
  })
}

export function useDeleteComment(interactionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: number) => api.delete(`/interactions/${interactionId}/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interactions', 'comments', interactionId] }),
  })
}
