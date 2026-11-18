import type {
  NavigationCoordinate,
  NavigationRoute,
  NavigationState,
  NavigationTargetType,
} from '@routecommand/shared'

import { authenticatedFetch } from '../../../features/auth/auth-client'

export interface NavigationSession {
  id: string
  driverId: string
  shipmentId: string
  status: string
  route: NavigationRoute
  waypoints: NavigationCoordinate[]
  targetType: NavigationTargetType
  distanceM: number
  durationS: number
  currentStepIndex: number
  rerouteCount: number
  startedAt: string | null
  updatedAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/v1/navigation${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }
  if (!response.ok || payload.data === undefined)
    throw new Error(payload.error?.message ?? 'Navigation request failed.')
  return payload.data
}

export const navigationApi = {
  active: () => request<NavigationSession | null>('/sessions/active/me'),
  activeAll: () => request<NavigationSession[]>('/sessions/active'),
  start: (shipmentId: string) =>
    request<NavigationSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ shipmentId }),
    }),
  reroute: (
    sessionId: string,
    position: NavigationCoordinate,
    accuracyM: number,
    heading: number | null,
    reason: 'OFF_ROUTE' | 'USER_REQUEST' | 'VEHICLE_CHANGED' | 'STOP_ADVANCED' = 'OFF_ROUTE',
  ) =>
    request<NavigationSession>(`/sessions/${sessionId}/reroute`, {
      method: 'POST',
      body: JSON.stringify({ position, accuracyM, heading, reason }),
    }),
  progress: (sessionId: string, state: NavigationState, position: NavigationCoordinate) =>
    request<{ ok: true }>(`/sessions/${sessionId}/progress`, {
      method: 'POST',
      body: JSON.stringify({
        stepIndex: state.currentStepIndex,
        remainingDistanceM: state.remainingDistanceM,
        etaSeconds: state.etaSeconds,
        offRoute: state.status === 'OFF_ROUTE',
        status: state.status,
        position,
        occurredAt: new Date().toISOString(),
      }),
    }),
  end: (sessionId: string, reason: 'ARRIVED' | 'CANCELLED' | 'MANUAL') =>
    request<NavigationSession>(`/sessions/${sessionId}/end`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
}
