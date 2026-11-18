import { authenticatedFetch } from '../../auth/auth-client'

export interface DriverSuggestion {
  driverId: string
  name: string
  vehicleType: string
  capacityKg: number
  distanceM: number
  etaSeconds: number
  lastSeenAt: string
  workload: number
  zoneMatch: boolean
  score: number
}

export interface DispatchBatchResult {
  driverId: string
  totalWeightKg: number
  stops: Array<{
    sequence: number
    distanceFromPreviousM: number
    shipment: { id: string; trackingCode: string; status: string }
  }>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Dispatch request could not be completed.')
  }
  return payload.data
}

export const dispatchApi = {
  suggestions: (shipmentId: string) => {
    const query = new URLSearchParams({ shipmentId })
    return request<DriverSuggestion[]>(`/dispatch/suggestions?${query}`)
  },
  assign: (shipmentId: string, driverId: string) =>
    request<{ shipment: { id: string; status: string }; event: { id: string } }>(
      '/dispatch/assign',
      {
        method: 'POST',
        body: JSON.stringify({ shipmentId, driverId }),
      },
    ),
  assignBatch: (shipmentIds: string[], driverId: string) =>
    request<DispatchBatchResult>('/dispatch/assign-batch', {
      method: 'POST',
      body: JSON.stringify({ shipmentIds, driverId }),
    }),
}
