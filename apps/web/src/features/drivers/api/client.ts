import type {
  CreateVehicleInput,
  CreateManagedUserInput,
  DriverStatus,
  ListDriversQuery,
  ListVehiclesQuery,
  UpdateDriverInput,
  UpdateVehicleInput,
} from '@routecommand/shared'

import { authenticatedFetch } from '../../auth/auth-client'

export interface Driver {
  id: string
  userId: string
  name: string
  email: string
  phone: string | null
  isActive: boolean
  licenseNo: string
  status: DriverStatus
  statusChangedAt: string
  rating: number | null
  vehicleId: string | null
  vehiclePlate: string | null
  vehicleType: string | null
  lng: number | null
  lat: number | null
  lastSeenAt: string | null
  signalState: 'NO_SIGNAL' | 'SIGNAL_LOST' | 'LIVE'
}

export interface Vehicle {
  id: string
  plate: string
  type: 'BIKE' | 'CAR' | 'VAN' | 'TRUCK'
  capacityKg: number
  isActive: boolean
  assignedDriverId: string | null
  assignedDriverName: string | null
  assignedDriverStatus: string | null
  createdAt: string
  updatedAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload = (await response.json()) as {
    data?: T
    error?: { message?: string; details?: { reason?: string; activeShipmentCount?: number } }
  }
  if (!response.ok || payload.data === undefined) {
    const error = new Error(payload.error?.message ?? 'The request could not be completed.')
    Object.assign(error, { status: response.status, details: payload.error?.details })
    throw error
  }
  return payload.data
}

function queryString(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params.size ? `?${params.toString()}` : ''
}

export const fleetApi = {
  drivers: (filters: Partial<ListDriversQuery> = {}) =>
    request<Driver[]>(`/drivers${queryString({ ...filters, limit: filters.limit ?? 100 })}`),
  driver: (id: string) => request<Driver>(`/drivers/${id}`),
  createDriver: (
    input: Pick<CreateManagedUserInput, 'email' | 'name' | 'password' | 'phone' | 'licenseNo'>,
  ) =>
    request<{ id: string }>('/users', {
      method: 'POST',
      body: JSON.stringify({ ...input, role: 'DRIVER' }),
    }),
  me: () => request<Driver>('/drivers/me'),
  updateDriver: (id: string, input: UpdateDriverInput) =>
    request<Driver>(`/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  updateMyStatus: (status: DriverStatus, force = false) =>
    request<Driver>('/drivers/me/status', {
      method: 'PATCH',
      body: JSON.stringify({ status, force }),
    }),
  assignVehicle: (driverId: string, vehicleId: string | null) =>
    request<Driver>(`/drivers/${driverId}/assign-vehicle`, {
      method: 'POST',
      body: JSON.stringify({ vehicleId }),
    }),
  vehicles: (filters: Partial<ListVehiclesQuery> = {}) =>
    request<Vehicle[]>(`/vehicles${queryString({ ...filters, limit: filters.limit ?? 100 })}`),
  createVehicle: (input: CreateVehicleInput) =>
    request<Vehicle>('/vehicles', { method: 'POST', body: JSON.stringify(input) }),
  updateVehicle: (id: string, input: UpdateVehicleInput) =>
    request<Vehicle>(`/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
}
