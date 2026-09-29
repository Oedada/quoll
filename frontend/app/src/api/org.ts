import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export type EffectiveStatus = 'AVAILABLE' | 'SATURATED' | 'UNAVAILABLE' | 'INACTIVE'

export interface ManagerLoadRead {
  id: string
  username: string | null
  first_name: string
  last_name: string
  patronymic: string
  superviser_id: string | null
  manual_workload_status: 'available' | 'unavailable'
  max_active_projects: number
  capacity_used: number
  open_projects: number
  blocking_projects: number
  effective_status: EffectiveStatus
}

export interface ProfileRead {
  id: string
  username: string | null
  email: string | null
  first_name: string
  last_name: string
  patronymic: string
  role: string
  is_active: boolean
  identity_sync_status: string
  role_transition_status: string
  load: ManagerLoadRead | null
  max_subordinates: number | null
  team_size: number | null
}

export function useProfile(userId: string | undefined) {
  return useQuery<ProfileRead>({
    queryKey: ['org', 'profile', userId],
    queryFn: () => api.get<ProfileRead>(`/org/profiles/${userId}`),
    enabled: !!userId,
  })
}

export function useSetMyWorkload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (manual_workload_status: 'available' | 'unavailable') =>
      api.patch<ManagerLoadRead>('/org/profiles/me/workload', { manual_workload_status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'profile'] })
    },
  })
}

export interface TeamRead {
  max_subordinates: number
  members: ManagerLoadRead[]
}

export interface SupervisorCapacityRead {
  id: string
  first_name: string
  last_name: string
  patronymic: string
  free_project_slots: number
}

export interface SupervisorQuotaRead {
  id: string
  first_name: string
  last_name: string
  patronymic: string
  free_places: number
}

export function useTeam() {
  return useQuery<TeamRead>({ queryKey: ['org', 'team'], queryFn: () => api.get<TeamRead>('/org/subordinates') })
}

export function useAssignmentPool() {
  return useQuery<ManagerLoadRead[]>({
    queryKey: ['org', 'assignment-pool'],
    queryFn: () => api.get<ManagerLoadRead[]>('/org/subordinates/assignment-pool'),
  })
}

export function useRecruitmentPool() {
  return useQuery<ManagerLoadRead[]>({
    queryKey: ['org', 'recruitment-pool'],
    queryFn: () => api.get<ManagerLoadRead[]>('/org/managers/recruitment-pool'),
  })
}

export function useOrphanedManagers() {
  return useQuery<ManagerLoadRead[]>({
    queryKey: ['org', 'orphaned'],
    queryFn: () => api.get<ManagerLoadRead[]>('/org/managers/orphaned'),
  })
}

export function useAvailableProjectCapacity() {
  return useQuery<SupervisorCapacityRead[]>({
    queryKey: ['org', 'available-project-capacity'],
    queryFn: () => api.get<SupervisorCapacityRead[]>('/org/supervisors/available-project-capacity'),
  })
}

export function useAvailableTeamQuota() {
  return useQuery<SupervisorQuotaRead[]>({
    queryKey: ['org', 'available-team-quota'],
    queryFn: () => api.get<SupervisorQuotaRead[]>('/org/supervisors/available-team-quota'),
  })
}

function invalidateTeam(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['org'] })
}

export function useRecruitManager() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (managerId: string) =>
      api.post(`/org/subordinates/${managerId}`, { expected_superviser_id: null }),
    onSuccess: () => invalidateTeam(qc),
  })
}

export function useAdoptManager() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ managerId, expectedSuperviserId }: { managerId: string; expectedSuperviserId: string | null }) =>
      api.post(`/org/subordinates/${managerId}/adopt`, { expected_superviser_id: expectedSuperviserId }),
    onSuccess: () => invalidateTeam(qc),
  })
}

export function useReleaseManager() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ managerId, expectedSuperviserId }: { managerId: string; expectedSuperviserId: string }) =>
      api.delete(`/org/subordinates/${managerId}?expected_superviser_id=${encodeURIComponent(expectedSuperviserId)}`),
    onSuccess: () => invalidateTeam(qc),
  })
}

export function useTransferManager() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      managerId,
      toSuperviserId,
      expectedSuperviserId,
    }: {
      managerId: string
      toSuperviserId: string
      expectedSuperviserId: string
    }) =>
      api.post(`/org/subordinates/${managerId}/transfer`, {
        to_superviser_id: toSuperviserId,
        expected_superviser_id: expectedSuperviserId,
      }),
    onSuccess: () => invalidateTeam(qc),
  })
}

export interface PendingActionRead {
  id: string
  action_type: string
  target_id: string
  origin_supervisor_id: string | null
  status: string
  retry_count: number
  next_retry_at: string | null
  last_error: string | null
  created_at: string
  completed_at: string | null
}

export function usePendingActions() {
  return useQuery<PendingActionRead[]>({
    queryKey: ['org', 'pending-actions'],
    queryFn: () => api.get<PendingActionRead[]>('/org/pending-actions'),
  })
}
