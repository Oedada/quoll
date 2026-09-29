// Мутации (создание/изменение/удаление) для справочников — доступны только администратору.
// GET-хуки уже есть в catalog.ts и catalog-extra.ts, переиспользуем их типы отсюда.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  DirectionRead,
  VendorRead,
  ProductRead,
  ProgramRead,
  SpecialtyRead,
  ContactRead,
  CloseReasonRead,
  DocumentKindRead,
} from './catalog-extra'
import type { UniversityRead } from './catalog'

// справочники ссылаются друг на друга (направления/продукты/вузы), поэтому
// после любой мутации проще сбросить весь кэш каталога целиком.
function invalidateCatalog(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['catalog'] })
}

// ---- Направления ----
export interface DirectionWrite {
  name: string
}

export function useCreateDirection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DirectionWrite) => api.post<DirectionRead>('/catalog/directions', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateDirection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<DirectionWrite> }) =>
      api.patch<DirectionRead>(`/catalog/directions/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteDirection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/directions/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}

// ---- Вендоры ----
export interface VendorWrite {
  name: string
  site?: string | null
  kind?: string | null
}

export function useCreateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: VendorWrite) => api.post<VendorRead>('/catalog/vendors', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<VendorWrite> }) =>
      api.patch<VendorRead>(`/catalog/vendors/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/vendors/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}

// ---- Продукты ----
export interface ProductWrite {
  name: string
  vendor_id: number
  contact_id?: number | null
  direction_ids: number[]
  description?: string | null
  url?: string | null
  is_active?: boolean
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProductWrite) => api.post<ProductRead>('/catalog/products', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ProductWrite> }) =>
      api.patch<ProductRead>(`/catalog/products/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/products/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}

// ---- Программы ----
export interface ProgramWrite {
  name: string
  direction_id: number
  product_ids?: number[]
  description?: string | null
  url?: string | null
  site_course_id?: string | null
  is_active?: boolean
}

export function useCreateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProgramWrite) => api.post<ProgramRead>('/catalog/programs', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ProgramWrite> }) =>
      api.patch<ProgramRead>(`/catalog/programs/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/programs/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useSetProgramPriority() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, priority }: { id: number; priority: number | null }) =>
      api.patch<ProgramRead>(`/catalog/programs/${id}/priority`, { priority }),
    onSuccess: () => invalidateCatalog(qc),
  })
}

// ---- Специальности ----
export interface SpecialtyWrite {
  code: string
  name: string
  level: 'BACHELOR' | 'SPECIALIST' | 'MASTER'
  direction_ids?: number[]
  tags?: string[]
}

export function useCreateSpecialty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SpecialtyWrite) => api.post<SpecialtyRead>('/catalog/specialties', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateSpecialty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<SpecialtyWrite> }) =>
      api.patch<SpecialtyRead>(`/catalog/specialties/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteSpecialty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/specialties/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}

// ---- Вузы ----
export interface UniversityWrite {
  full_name: string
  short_name: string
  inn: string
  kpp?: string | null
  site?: string | null
  region: string
  city: string
}

export function useCreateUniversity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UniversityWrite) => api.post<UniversityRead>('/catalog/universities', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateUniversity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<UniversityWrite> }) =>
      api.patch<UniversityRead>(`/catalog/universities/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteUniversity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/universities/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}
// текущий состав специальностей вуза — отдельного GET для этого нет,
// используем фильтр по university_id на общем списке специальностей.
export function useSpecialtiesByUniversity(universityId: number | undefined) {
  return useQuery<SpecialtyRead[]>({
    queryKey: ['catalog', 'specialties', 'by-university', universityId],
    queryFn: () => api.get<SpecialtyRead[]>(`/catalog/specialties?university_id=${universityId}&limit=100`),
    enabled: universityId != null,
  })
}
export function useSetUniversitySpecialties() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, specialtyIds }: { id: number; specialtyIds: number[] }) =>
      api.put<SpecialtyRead[]>(`/catalog/universities/${id}/specialties`, { specialty_ids: specialtyIds }),
    onSuccess: () => invalidateCatalog(qc),
  })
}

// ---- Контакты ----
export interface ContactWrite {
  university_id?: number | null
  vendor_id?: number | null
  full_name: string
  phone?: string | null
  email?: string | null
  position?: string | null
  contact_methods?: string[]
  is_actual?: boolean
}

export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ContactWrite) => api.post<ContactRead>('/catalog/contacts', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ContactWrite> }) =>
      api.patch<ContactRead>(`/catalog/contacts/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/contacts/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}

// ---- Причины закрытия ----
// после создания код/уровень/исход неизменны (PATCH разрешает только label и needs_comment)
export interface CloseReasonWrite {
  code: string
  label: string
  level: 'INTERACTION_BEFORE_SIGNING' | 'INTERACTION_AFTER_SIGNING' | 'BRANCH'
  outcome: 'DONE' | 'REFUSED'
  needs_comment?: boolean
}
export interface CloseReasonPatch {
  label?: string
  needs_comment?: boolean
}

export function useCreateCloseReason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CloseReasonWrite) => api.post<CloseReasonRead>('/catalog/close-reasons', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateCloseReason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: CloseReasonPatch }) =>
      api.patch<CloseReasonRead>(`/catalog/close-reasons/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteCloseReason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/close-reasons/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}

// ---- Виды документов ----
// после создания код неизменен (PATCH разрешает только label)
export interface DocumentKindWrite {
  code: string
  label: string
}
export interface DocumentKindPatch {
  label?: string
}

export function useCreateDocumentKind() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DocumentKindWrite) => api.post<DocumentKindRead>('/catalog/document-kinds', body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useUpdateDocumentKind() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DocumentKindPatch }) =>
      api.patch<DocumentKindRead>(`/catalog/document-kinds/${id}`, body),
    onSuccess: () => invalidateCatalog(qc),
  })
}
export function useDeleteDocumentKind() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/catalog/document-kinds/${id}`),
    onSuccess: () => invalidateCatalog(qc),
  })
}
