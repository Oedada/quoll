import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../auth/RequireAuth'
import { useMe } from '../auth/useMe'
import { ManagerApp } from '../manager/ManagerApp'
import { SupervisorApp } from '../supervisor/SupervisorApp'
import { AdminApp } from '../admin/AdminApp'

function RoleRoot() {
  const { data: me } = useMe()
  if (!me) return null
  if (me.role === 'manager') return <Navigate to="/manager" replace />
  if (me.role === 'superviser') return <Navigate to="/supervisor" replace />
  if (me.role === 'admin') return <Navigate to="/admin" replace />
  return null
}

export function App() {
  return (
    <RequireAuth>
      <Routes>
        <Route path="/manager/*" element={<ManagerApp />} />
        <Route path="/supervisor/*" element={<SupervisorApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<RoleRoot />} />
      </Routes>
    </RequireAuth>
  )
}
