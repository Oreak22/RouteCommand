import { Navigate } from 'react-router-dom'

import { useAuth } from '../features/auth/auth-context'
import { CustomerDashboardPage } from './CustomerDashboardPage'
import { DashboardPage } from './DashboardPage'

export function AppDashboardPage() {
  const { user } = useAuth()
  if (user?.role === 'CUSTOMER') return <CustomerDashboardPage />
  if (user?.role === 'DRIVER') return <Navigate replace to="/driver" />
  return <DashboardPage />
}
