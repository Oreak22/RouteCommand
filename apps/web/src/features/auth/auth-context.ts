import type { AuthUser, LoginInput, RegisterInput } from '@routecommand/shared'
import { createContext, useContext } from 'react'

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login(input: LoginInput): Promise<AuthUser>
  register(input: RegisterInput): Promise<AuthUser>
  logout(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
