import type { AuthUser } from '@routecommand/shared'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  accessTokenExpiresAt,
  clearAccessToken,
  loginRequest,
  logoutRequest,
  refreshRequest,
  registerRequest,
} from './auth-client'
import { AuthContext } from './auth-context'
import type { AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let current = true
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('routecommand-auth')
    if (channel) {
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === 'logout') {
          clearAccessToken()
          setUser(null)
        }
      }
    }
    refreshRequest()
      .then((restored) => {
        if (current) setUser(restored)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
      channel?.close()
    }
  }, [])

  useEffect(() => {
    if (!user) return
    const expiresAt = accessTokenExpiresAt()
    if (!expiresAt) return
    const timer = setTimeout(
      () => {
        refreshRequest().then((refreshed) => setUser(refreshed))
      },
      Math.max(0, expiresAt - Date.now() - 60_000),
    )
    return () => clearTimeout(timer)
  }, [user])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(input) {
        const signedIn = await loginRequest(input)
        setUser(signedIn)
        return signedIn
      },
      async register(input) {
        const registered = await registerRequest(input)
        setUser(registered)
        return registered
      },
      async logout() {
        try {
          await logoutRequest()
        } finally {
          setUser(null)
          if (typeof BroadcastChannel !== 'undefined') {
            const channel = new BroadcastChannel('routecommand-auth')
            channel.postMessage('logout')
            channel.close()
          }
        }
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
