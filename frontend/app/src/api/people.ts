import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { UserRole } from './types'

// минимум о человеке для подписей в интерфейсе - доступно любому вошедшему
export interface PersonRead {
  id: string
  last_name: string
  first_name: string
  patronymic: string
  role: UserRole
  is_active: boolean
}

const ROLE_LABEL: Record<UserRole, string> = {
  manager: 'Менеджер',
  superviser: 'Руководитель',
  admin: 'Администратор',
}

export function personFullName(p: PersonRead): string {
  const name = [p.last_name, p.first_name, p.patronymic].filter(Boolean).join(' ')
  // в демо-данных ФИО часто не заполнено - показываем роль, а не пустоту
  return name || ROLE_LABEL[p.role] || p.id
}

export function usePeople(ids: Array<string | undefined | null>) {
  const cleanIds = Array.from(new Set(ids.filter((id): id is string => !!id))).sort()
  const query = cleanIds.map((id) => `ids=${encodeURIComponent(id)}`).join('&')
  return useQuery<PersonRead[]>({
    queryKey: ['org', 'people', cleanIds],
    queryFn: () => api.get<PersonRead[]>(`/org/people?${query}`),
    enabled: cleanIds.length > 0,
  })
}
