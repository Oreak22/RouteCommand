import { Navigate } from 'react-router-dom'

import { CustomerDashboardPage } from './CustomerDashboardPage'
import { DashboardPage } from './DashboardPage'
import { useAuth } from '../features/auth/auth-context'

export function AppDashboardPage() {
  const { user } = useAuth()
  if (user?.role === 'CUSTOMER') return <CustomerDashboardPage />
  if (user?.role === 'DRIVER') return <Navigate replace to="/driver" />
  return <DashboardPage />
}
