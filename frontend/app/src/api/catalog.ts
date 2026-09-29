import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface UniversityRead {
  id: number
  full_name: string
  short_name: string
  inn: string | null
  kpp: string | null
  site: string | null
  region: string | null
  city: string | null
}

export function useUniversities() {
  return useQuery<UniversityRead[]>({
    queryKey: ['catalog', 'universities'],
    queryFn: () => api.get<UniversityRead[]>('/catalog/universities?limit=100'),
    staleTime: 5 * 60_000,
  })
}
