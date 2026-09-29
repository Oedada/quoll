// Доп. справочники для экрана "Справочники" (roles menedzher/admin), не входящие в catalog.ts.
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface DirectionRead {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export interface Ref {
  id: number
  name: string
}

export interface ProductRef {
  id: number
  name: string
  vendor_id: number
}

export interface VendorRead {
  id: number
  name: string
  site: string | null
  kind: string | null
  created_at: string
  updated_at: string
}

export interface ProductRead {
  id: number
  name: string
  vendor_id: number
  contact_id: number | null
  directions: Ref[]
  description: string | null
  url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProgramRead {
  id: number
  name: string
  direction_id: number
  products: ProductRef[]
  description: string | null
  url: string | null
  priority: number | null
  site_course_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SpecialtyRead {
  id: number
  code: string
  name: string
  level: string
  directions: Ref[]
  tags: string[]
  created_at: string
  updated_at: string
}

export interface ContactRead {
  id: number
  university_id: number | null
  vendor_id: number | null
  full_name: string
  phone: string | null
  email: string | null
  position: string | null
  contact_methods: string[]
  is_actual: boolean
  created_at: string
  updated_at: string
}

export interface CloseReasonRead {
  id: number
  code: string
  label: string
  level: string
  outcome: string
  needs_comment: boolean
  is_system: boolean
}

export interface DocumentKindRead {
  id: number
  code: string
  label: string
  is_system: boolean
}

export function useDirections() {
  return useQuery<DirectionRead[]>({
    queryKey: ['catalog', 'directions'],
    queryFn: () => api.get<DirectionRead[]>('/catalog/directions?limit=100'),
    staleTime: 5 * 60_000,
  })
}

export function useVendors() {
  return useQuery<VendorRead[]>({
    queryKey: ['catalog', 'vendors'],
    queryFn: () => api.get<VendorRead[]>('/catalog/vendors?limit=100'),
    staleTime: 5 * 60_000,
  })
}

export function useProducts() {
  return useQuery<ProductRead[]>({
    queryKey: ['catalog', 'products'],
    queryFn: () => api.get<ProductRead[]>('/catalog/products?limit=100'),
    staleTime: 5 * 60_000,
  })
}

export function usePrograms() {
  return useQuery<ProgramRead[]>({
    queryKey: ['catalog', 'programs'],
    queryFn: () => api.get<ProgramRead[]>('/catalog/programs?limit=100'),
    staleTime: 5 * 60_000,
  })
}

export function useSpecialties() {
  return useQuery<SpecialtyRead[]>({
    queryKey: ['catalog', 'specialties'],
    queryFn: () => api.get<SpecialtyRead[]>('/catalog/specialties?limit=100'),
    staleTime: 5 * 60_000,
  })
}

export function useContacts() {
  return useQuery<ContactRead[]>({
    queryKey: ['catalog', 'contacts'],
    queryFn: () => api.get<ContactRead[]>('/catalog/contacts?limit=100'),
    staleTime: 5 * 60_000,
  })
}

export function useCloseReasons() {
  return useQuery<CloseReasonRead[]>({
    queryKey: ['catalog', 'close-reasons'],
    queryFn: () => api.get<CloseReasonRead[]>('/catalog/close-reasons'),
    staleTime: 5 * 60_000,
  })
}

export function useDocumentKinds() {
  return useQuery<DocumentKindRead[]>({
    queryKey: ['catalog', 'document-kinds'],
    queryFn: () => api.get<DocumentKindRead[]>('/catalog/document-kinds'),
    staleTime: 5 * 60_000,
  })
}
