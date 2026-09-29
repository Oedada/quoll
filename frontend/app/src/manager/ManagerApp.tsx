import { Route, Routes } from 'react-router-dom'
import { ManagerShell } from './ManagerShell'
import DashboardPage from './pages/DashboardPage'
import InboxPage from './pages/InboxPage'
import MyInteractionsPage from './pages/MyInteractionsPage'
import InteractionCardPage from './pages/InteractionCardPage'
import RequestsPage from './pages/RequestsPage'
import StatusPage from './pages/StatusPage'
import ReportsPage from './pages/ReportsPage'
import RefsPage from './pages/RefsPage'
import ProfilePage from './pages/ProfilePage'

export function ManagerApp() {
  return (
    <Routes>
      <Route element={<ManagerShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="interactions" element={<MyInteractionsPage />} />
        <Route path="interactions/:id" element={<InteractionCardPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="refs" element={<RefsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  )
}
