import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { UserRead } from '../api/types'

export function useMe() {
  return useQuery<UserRead, ApiError>({
    queryKey: ['me'],
    queryFn: () => api.get<UserRead>('/users/me'),
    retry: false,
    staleTime: 60_000,
  })
}
