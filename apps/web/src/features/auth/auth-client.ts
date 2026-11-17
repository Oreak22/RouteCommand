import type { AuthUser, LoginInput, RegisterInput } from '@routecommand/shared'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'
let accessToken: string | null = null
let refreshInFlight: Promise<AuthUser | null> | null = null

interface AuthPayload {
  data: { user: AuthUser; accessToken: string }
}

async function readPayload(response: Response): Promise<AuthPayload> {
  const body = (await response.json()) as AuthPayload | { error?: { message?: string } }
  if (!response.ok || !('data' in body)) {
    throw new Error(
      ('error' in body && body.error?.message) || 'The request could not be completed.',
    )
  }
  return body
}

export function currentAccessToken(): string | null {
  return accessToken
}

export function clearAccessToken(): void {
  accessToken = null
}

export function accessTokenExpiresAt(): number | null {
  if (!accessToken) return null
  try {
    const encodedPayload = accessToken.split('.')[1]
    if (!encodedPayload) return null
    const payload = JSON.parse(atob(encodedPayload.replaceAll('-', '+').replaceAll('_', '/'))) as {
      exp?: unknown
    }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

async function requestSession(path: string, body?: unknown): Promise<AuthPayload> {
  const response = await fetch(`${apiBase}/api/v1/auth/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'RouteCommand' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await readPayload(response)
  accessToken = payload.data.accessToken
  return payload
}

export async function loginRequest(input: LoginInput): Promise<AuthUser> {
  return (await requestSession('login', input)).data.user
}

export async function registerRequest(input: RegisterInput): Promise<AuthUser> {
  return (await requestSession('register', input)).data.user
}

export async function submitAuthAction<T extends object>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase}/api/v1/auth/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'RouteCommand' },
    body: JSON.stringify(body),
  })
  if (response.status === 204) return undefined as unknown as T
  const payload = (await response.json()) as { data?: unknown; error?: { message?: string } }
  if (!response.ok || !('data' in payload)) {
    throw new Error(payload.error?.message || 'The request could not be completed.')
  }
  return payload as T
}

export async function refreshRequest(): Promise<AuthUser | null> {
  if (!refreshInFlight) {
    const refresh = async () => {
      try {
        return (await requestSession('refresh')).data.user
      } catch {
        accessToken = null
        return null
      }
    }
    refreshInFlight = (async () => {
      if (navigator.locks) return navigator.locks.request('routecommand-refresh-token', refresh)
      return refresh()
    })()
      .catch(() => {
        accessToken = null
        return null
      })
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

export async function logoutRequest(): Promise<void> {
  try {
    await fetch(`${apiBase}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-requested-with': 'RouteCommand',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    })
  } finally {
    accessToken = null
  }
}

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  let response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include' })
  if (response.status !== 401) return response
  const user = await refreshRequest()
  if (!user || !accessToken) return response
  headers.set('authorization', `Bearer ${accessToken}`)
  response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include' })
  return response
}
