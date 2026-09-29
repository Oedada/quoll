// Раздел «Шаблоны» — вложения-шаблоны (attachments) для переходов воркфлоу.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'

export interface TransitionRef {
  id: number
  name: string
}

export interface AttachmentRead {
  id: number
  filename: string
  mime_type: string
  preview: string | null
  title: string | null
  category: string | null
  storage_key: string
  size_bytes: number
  created_at: string
  updated_at: string
}

export interface AttachmentListRead extends AttachmentRead {
  used_by: TransitionRef[]
}

export interface PresignedUrlResponse {
  url: string
  expires_in: number
}

const ATTACHMENTS_KEY = ['attachments'] as const

export function useAttachments() {
  return useQuery({
    queryKey: ATTACHMENTS_KEY,
    queryFn: () => api.get<AttachmentListRead[]>('/attachments/'),
  })
}

export interface UploadAttachmentInput {
  file: File
  title: string
  category?: string
  preview?: string
}

export function useUploadAttachment() {
  const qc = useQueryClient()
  return useMutation({
    // multipart: client.ts json-only, поэтому свой fetch
    mutationFn: async (input: UploadAttachmentInput) => {
      const form = new FormData()
      form.append('file', input.file)
      form.append('title', input.title)
      if (input.category) form.append('category', input.category)
      if (input.preview) form.append('preview', input.preview)
      const res = await fetch('/api/v1/attachments/', {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new ApiError(res.status, payload?.detail ?? payload)
      }
      return (await res.json()) as AttachmentRead
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ATTACHMENTS_KEY }),
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ATTACHMENTS_KEY }),
  })
}

export function useAttachmentPresignedUrl() {
  return useMutation({
    mutationFn: (id: number) => api.get<PresignedUrlResponse>(`/attachments/${id}/presigned-url`),
  })
}

export function attachmentDownloadUrl(id: number): string {
  return `/api/v1/attachments/${id}/download`
}
