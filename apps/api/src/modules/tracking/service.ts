import type { PublicTrackingResponse, PublicTrackingUpdate } from '@routecommand/shared'

import {
  findCustomerTrackingRecord,
  findTrackingRecord,
  listDriverTrackingUpdateRecords,
} from './repository.js'
import { env } from '../../config/env.js'

const locationVisibleStatuses = new Set(['PICKED_UP', 'IN_TRANSIT', 'ARRIVED'])
const trackingCodePattern = /^RC-[0-9A-HJKMNP-TV-Z]{10}$/

function roundedCoordinates(
  status: string,
  latitude: number | null,
  longitude: number | null,
  recordedAt: Date | null,
) {
  if (
    !locationVisibleStatuses.has(status) ||
    latitude === null ||
    longitude === null ||
    !recordedAt
  )
    return null

  const ageMs = Date.now() - recordedAt.getTime()
  if (ageMs < -60_000 || ageMs > env.PUBLIC_TRACKING_LOCATION_MAX_AGE_SECONDS * 1_000) return null
  const factor = 10 ** env.PUBLIC_TRACKING_LOCATION_DECIMALS
  return {
    lat: Math.round(latitude * factor) / factor,
    lng: Math.round(longitude * factor) / factor,
    recordedAt: recordedAt.toISOString(),
  }
}

function roundedLocation(record: Awaited<ReturnType<typeof findTrackingRecord>>) {
  return record
    ? roundedCoordinates(
        record.status,
        record.locationLat,
        record.locationLng,
        record.locationRecordedAt,
      )
    : null
}

function notFound(trackingCode: string): PublicTrackingResponse {
  return {
    found: false,
    trackingCode: trackingCodePattern.test(trackingCode) ? trackingCode : null,
    status: 'NOT_FOUND',
    events: [],
    eta: null,
    dropoff: null,
    driver: null,
    location: null,
    updatedAt: null,
  }
}

function toPublicTracking(
  record: NonNullable<Awaited<ReturnType<typeof findTrackingRecord>>>,
): PublicTrackingResponse {
  const factor = 10 ** env.PUBLIC_TRACKING_LOCATION_DECIMALS
  return {
    found: true,
    trackingCode: record.trackingCode,
    status: record.status,
    events: record.events,
    eta: record.eta?.toISOString() ?? null,
    dropoff: {
      lat: Math.round(record.dropoffLat * factor) / factor,
      lng: Math.round(record.dropoffLng * factor) / factor,
      address: null,
    },
    driver: record.firstName
      ? { firstName: record.firstName, vehicleType: record.vehicleType }
      : null,
    location: roundedLocation(record),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function getPublicTracking(trackingCode: string): Promise<PublicTrackingResponse> {
  const record = await findTrackingRecord(trackingCode)
  return record ? toPublicTracking(record) : notFound(trackingCode)
}

export async function getCustomerTracking(
  trackingCode: string,
  customerId: string,
): Promise<PublicTrackingResponse> {
  const record = await findCustomerTrackingRecord(trackingCode, customerId)
  const response = toPublicTracking(record)
  response.dropoff = {
    lat: record.dropoffLat,
    lng: record.dropoffLng,
    address: record.dropoffAddress,
  }
  if (
    locationVisibleStatuses.has(record.status) &&
    record.locationLat !== null &&
    record.locationLng !== null &&
    record.locationRecordedAt
  ) {
    const ageMs = Date.now() - record.locationRecordedAt.getTime()
    if (ageMs >= -60_000 && ageMs <= env.PUBLIC_TRACKING_LOCATION_MAX_AGE_SECONDS * 1_000) {
      response.location = {
        lat: record.locationLat,
        lng: record.locationLng,
        recordedAt: record.locationRecordedAt.toISOString(),
      }
    }
  }
  return response
}

export async function getDriverTrackingUpdates(
  driverIds: string[],
): Promise<Map<string, Array<{ trackingCode: string; update: PublicTrackingUpdate }>>> {
  const result = new Map<string, Array<{ trackingCode: string; update: PublicTrackingUpdate }>>()
  const records = await listDriverTrackingUpdateRecords(driverIds)
  for (const record of records) {
    const updates = result.get(record.driverId) ?? []
    updates.push({
      trackingCode: record.trackingCode,
      update: {
        status: record.status,
        eta: record.eta?.toISOString() ?? null,
        location: roundedCoordinates(
          record.status,
          record.locationLat,
          record.locationLng,
          record.locationRecordedAt,
        ),
        updatedAt: record.updatedAt.toISOString(),
      },
    })
    result.set(record.driverId, updates)
  }
  return result
}
