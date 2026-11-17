import type {
  CancelShipmentInput,
  CreateShipmentInput,
  ListShipmentsQuery,
  ShipmentPriority,
  ShipmentStatus,
  TransitionShipmentInput,
  UpdateShipmentInput,
} from '@routecommand/shared'

import { authenticatedFetch } from '../../auth/auth-client'

export interface Shipment {
  id: string
  trackingCode: string
  customerId: string
  customerName: string
  customerEmail: string
  driverId: string | null
  driverUserId: string | null
  driverName: string | null
  driverStatus: string | null
  status: ShipmentStatus
  pickupAddress: string
  pickup: { lat: number; lng: number }
  dropoffAddress: string
  dropoff: { lat: number; lng: number }
  weightKg: number
  priority: ShipmentPriority
  notes: string | null
  scheduledAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  eta: string | null
  createdAt: string
  updatedAt: string
  allowedTransitions?: ShipmentStatus[]
  canCancel?: boolean
}

export interface ShipmentEvent {
  id: string
  shipmentId: string
  status: ShipmentStatus
  actorId: string | null
  actorName: string | null
  note: string | null
  location: { lat: number; lng: number } | null
  createdAt: string
}

export interface ShipmentCustomer {
  id: string
  name: string
  email: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload = (await response.json()) as {
    data?: T
    error?: { message?: string; details?: unknown }
  }
  if (!response.ok || payload.data === undefined) {
    const error = new Error(payload.error?.message ?? 'The request could not be completed.')
    Object.assign(error, { status: response.status, details: payload.error?.details })
    throw error
  }
  return payload.data
}

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params.size ? `?${params.toString()}` : ''
}

export const shipmentsApi = {
  list: (filters: Partial<ListShipmentsQuery> = {}) =>
    request<Shipment[]>(`/shipments${queryString(filters)}`),
  detail: (id: string) => request<Shipment>(`/shipments/${id}`),
  events: (id: string) => request<ShipmentEvent[]>(`/shipments/${id}/events`),
  customers: (search = '') =>
    request<ShipmentCustomer[]>(`/shipments/customers${queryString({ search, limit: 100 })}`),
  create: (input: CreateShipmentInput) =>
    request<Shipment>('/shipments', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateShipmentInput) =>
    request<Shipment>(`/shipments/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  transition: (id: string, input: TransitionShipmentInput, key: string) =>
    request<{ shipment: Shipment; event: ShipmentEvent }>(`/shipments/${id}/transition`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(input),
    }),
  cancel: (id: string, input: CancelShipmentInput) =>
    request<{ shipment: Shipment; event: ShipmentEvent }>(`/shipments/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
