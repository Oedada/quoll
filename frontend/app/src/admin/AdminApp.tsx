import { Route, Routes } from 'react-router-dom'
import { AdminShell } from './AdminShell'
import HealthPage from './pages/HealthPage'
import UsersPage from './pages/UsersPage'
import OrganizationPage from './pages/OrganizationPage'
import WorkflowsAdminPage from './pages/WorkflowsAdminPage'
import TemplatesPage from './pages/TemplatesPage'
import RefsAdminPage from './pages/RefsAdminPage'
import ImportPage from './pages/ImportPage'
import IntegrationsPage from './pages/IntegrationsPage'
import AllInteractionsPage from './pages/AllInteractionsPage'
import InteractionCardAdminPage from './pages/InteractionCardAdminPage'
import ReportsAdminPage from './pages/ReportsAdminPage'
import NotificationsFeedPage from './pages/NotificationsFeedPage'
import AdminProfilePage from './pages/AdminProfilePage'
// предложения интеграции только для чтения у администратора - переиспользуем компонент руководителя
import ProposalsPage from '../supervisor/pages/ProposalsPage'

export function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<HealthPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="org" element={<OrganizationPage />} />
        <Route path="wf" element={<WorkflowsAdminPage />} />
        <Route path="tpl" element={<TemplatesPage />} />
        <Route path="refs" element={<RefsAdminPage />} />
        <Route path="imp" element={<ImportPage />} />
        <Route path="integ" element={<IntegrationsPage />} />
        <Route path="proposals" element={<ProposalsPage />} />
        <Route path="all" element={<AllInteractionsPage />} />
        <Route path="all/:id" element={<InteractionCardAdminPage />} />
        <Route path="reports" element={<ReportsAdminPage />} />
        <Route path="feed" element={<NotificationsFeedPage />} />
        <Route path="profile" element={<AdminProfilePage />} />
      </Route>
    </Routes>
  )
}
