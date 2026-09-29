export type UserRole = 'manager' | 'superviser' | 'admin'

export interface UserRead {
  id: string
  username: string | null
  email: string | null
  first_name: string
  last_name: string
  patronymic: string
  role: UserRole
  is_active: boolean
  superviser_id: string | null
  max_active_projects: number | null
  max_subordinates: number | null
}

export interface DemoAccount {
  username: string
  password: string
  role: UserRole
}
