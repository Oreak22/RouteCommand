import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { Spinner } from '../components/ui/Spinner'
import { useAuth } from '../features/auth/auth-context'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Restoring session" />
      </div>
    )
  if (!user) return <Navigate replace to="/login" state={{ from: location.pathname }} />
  return <>{children}</>
}
