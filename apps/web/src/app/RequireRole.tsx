import type { UserRole } from '@routecommand/shared'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../features/auth/auth-context'

export type AppRole = UserRole

export function RequireRole({ children, roles }: { children: ReactNode; roles: UserRole[] }) {
  const { user } = useAuth()
  if (!user) return <Navigate replace to="/login" />
  if (!roles.includes(user.role)) {
    const destination = user.role === 'DRIVER' ? '/driver' : '/app/dashboard'
    return <Navigate replace to={destination} />
  }
  return <>{children}</>
}
