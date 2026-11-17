import type {
  CheckZonePointInput,
  CreateZoneInput,
  ListZonesQuery,
  UpdateZoneInput,
  ZoneGeometry,
  ZoneType,
} from '@routecommand/shared'

import { authenticatedFetch } from '../../auth/auth-client'

export interface Zone {
  id: string
  name: string
  type: ZoneType
  geometry: ZoneGeometry
  color: string
  isActive: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ZoneFeature {
  type: 'Feature'
  id: string
  geometry: ZoneGeometry
  properties: Pick<Zone, 'id' | 'name' | 'type' | 'color' | 'isActive' | 'updatedAt'>
}

export interface ZoneFeatureCollection {
  type: 'FeatureCollection'
  features: ZoneFeature[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload = (await response.json()) as {
    data?: T
    error?: { message?: string }
  }
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'The request could not be completed.')
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

export const zonesApi = {
  list: (filters: Partial<ListZonesQuery> = {}) => request<Zone[]>(`/zones${queryString(filters)}`),
  geoJson: (toleranceM = 0) =>
    request<ZoneFeatureCollection>(`/zones/geojson${queryString({ toleranceM })}`),
  create: (input: CreateZoneInput) =>
    request<Zone>('/zones', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateZoneInput) =>
    request<Zone>(`/zones/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deactivate: (id: string, expectedUpdatedAt: string) =>
    request<Zone>(`/zones/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ expectedUpdatedAt }),
    }),
  checkPoint: (point: CheckZonePointInput) =>
    request<Pick<Zone, 'id' | 'name' | 'type' | 'color'>[]>('/zones/check-point', {
      method: 'POST',
      body: JSON.stringify(point),
    }),
}
