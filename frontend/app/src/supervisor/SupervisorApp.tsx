import { Route, Routes } from 'react-router-dom'
import { SupervisorShell } from './SupervisorShell'
import DashboardPage from './pages/DashboardPage'
import InteractionsPage from './pages/InteractionsPage'
import InteractionCardPage from './pages/InteractionCardPage'
import RequestDecisionsPage from './pages/RequestDecisionsPage'
import TeamPage from './pages/TeamPage'
import RecruitPage from './pages/RecruitPage'
import AllocationPage from './pages/AllocationPage'
import ProposalsPage from './pages/ProposalsPage'
import WorkflowsPage from './pages/WorkflowsPage'
import ReportsPage from './pages/ReportsPage'
import ProfilePage from './pages/ProfilePage'
// справочники read-only и одинаковы для менеджера и руководителя - переиспользуем компонент
import RefsPage from '../manager/pages/RefsPage'

export function SupervisorApp() {
  return (
    <Routes>
      <Route element={<SupervisorShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="interactions" element={<InteractionsPage />} />
        <Route path="interactions/:id" element={<InteractionCardPage />} />
        <Route path="requests" element={<RequestDecisionsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="recruit" element={<RecruitPage />} />
        <Route path="alloc" element={<AllocationPage />} />
        <Route path="proposals" element={<ProposalsPage />} />
        <Route path="wf" element={<WorkflowsPage />} />
        <Route path="refs" element={<RefsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  )
}
