import { maxZoneAreaM2 } from '@routecommand/shared'
import type {
  CreateZoneInput,
  ListZonesQuery,
  UpdateZoneInput,
  ZoneGeometry,
} from '@routecommand/shared'

import {
  deactivateZone as persistDeactivation,
  findZonesContainingPoint,
  getZone,
  insertZone,
  listActiveZonesGeoJson,
  listZones,
  lockZone,
  updateZone,
  validateZoneGeometry,
  type ZoneRecord,
} from './repository.js'
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { withTransaction } from '../../db/pool.js'
import { redisClient } from '../../infra/redis.js'
import type { AuthRequestContext } from '../auth/types.js'

const activeZoneCacheKey = 'routecommand:zones:active-geojson:v1'

export type ZoneFeatureCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    id: string
    geometry: ZoneGeometry
    properties: Pick<ZoneRecord, 'id' | 'name' | 'type' | 'color' | 'isActive' | 'updatedAt'>
  }>
}

async function validateGeometry(geometry: ZoneGeometry): Promise<void> {
  const result = await validateZoneGeometry(geometry)
  if (!result.is_valid) {
    const reason = result.validity_reason.split('[')[0]?.trim() || 'Invalid polygon topology'
    throw new BadRequestError(`Zone boundary is invalid: ${reason}.`, { reason })
  }
  if (result.area_m2 !== null && result.area_m2 > maxZoneAreaM2) {
    throw new BadRequestError('Zone geometry exceeds the maximum area.', {
      maxAreaM2: maxZoneAreaM2,
    })
  }
}

async function invalidateActiveZonesCache(): Promise<void> {
  if (!redisClient.isReady) return
  try {
    await redisClient.del(activeZoneCacheKey)
  } catch {
    // Cache failures must not turn a committed zone change into a failed request.
  }
}

export async function listZoneRecords(input: ListZonesQuery): Promise<ZoneRecord[]> {
  return listZones(input)
}

export async function getZoneRecord(zoneId: string): Promise<ZoneRecord> {
  const zone = await getZone(zoneId)
  if (!zone) throw new NotFoundError('Zone was not found.')
  return zone
}

export async function createZoneRecord(
  input: CreateZoneInput,
  actorId: string,
  context: AuthRequestContext,
): Promise<ZoneRecord> {
  await validateGeometry(input.geometry)
  try {
    const zone = await withTransaction(async (executor, afterCommit) => {
      const created = await insertZone(input, actorId, executor)
      await executor.query(
        `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
         VALUES ($1, 'zones.created', 'zone', $2, $3::jsonb, $4)`,
        [
          actorId,
          created.id,
          JSON.stringify({ name: created.name, type: created.type }),
          context.ip ?? null,
        ],
      )
      domainEventBus.publishAfterCommit(afterCommit, 'zone.updated', {
        zoneId: created.id,
        action: 'created',
        updatedAt: created.updatedAt,
      })
      return created
    })
    await invalidateActiveZonesCache()
    return zone
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new ConflictError('A zone with that name and type already exists.')
    }
    throw error
  }
}

export async function updateZoneRecord(
  zoneId: string,
  input: UpdateZoneInput,
  actorId: string,
  context: AuthRequestContext,
): Promise<ZoneRecord> {
  if (input.geometry) await validateGeometry(input.geometry)
  try {
    const zone = await withTransaction(async (executor, afterCommit) => {
      const locked = await lockZone(zoneId, executor)
      if (!locked) throw new NotFoundError('Zone was not found.')
      if (locked.updated_at !== input.expectedUpdatedAt) {
        throw new ConflictError('This zone changed since it was loaded. Reload it before saving.', {
          reason: 'ZONE_MODIFIED',
        })
      }
      const updated = await updateZone(zoneId, input, executor)
      if (!updated) throw new ConflictError('This zone changed before the update could be saved.')
      await executor.query(
        `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
         VALUES ($1, 'zones.updated', 'zone', $2, $3::jsonb, $4)`,
        [
          actorId,
          zoneId,
          JSON.stringify({
            name: input.name,
            type: input.type,
            geometryChanged: input.geometry !== undefined,
            color: input.color,
            isActive: input.isActive,
          }),
          context.ip ?? null,
        ],
      )
      domainEventBus.publishAfterCommit(afterCommit, 'zone.updated', {
        zoneId,
        action: 'updated',
        updatedAt: updated.updatedAt,
      })
      return updated
    })
    await invalidateActiveZonesCache()
    return zone
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new ConflictError('A zone with that name and type already exists.')
    }
    throw error
  }
}

export async function deactivateZoneRecord(
  zoneId: string,
  expectedUpdatedAt: string,
  actorId: string,
  context: AuthRequestContext,
): Promise<ZoneRecord> {
  const zone = await withTransaction(async (executor, afterCommit) => {
    const locked = await lockZone(zoneId, executor)
    if (!locked) throw new NotFoundError('Zone was not found.')
    if (locked.updated_at !== expectedUpdatedAt) {
      throw new ConflictError('This zone changed since it was loaded. Reload it before deleting.', {
        reason: 'ZONE_MODIFIED',
      })
    }
    const deactivated = await persistDeactivation(zoneId, expectedUpdatedAt, executor)
    if (!deactivated) throw new ConflictError('This zone is already inactive or has changed.')
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
       VALUES ($1, 'zones.deactivated', 'zone', $2, '{}'::jsonb, $3)`,
      [actorId, zoneId, context.ip ?? null],
    )
    domainEventBus.publishAfterCommit(afterCommit, 'zone.updated', {
      zoneId,
      action: 'deactivated',
      updatedAt: deactivated.updatedAt,
    })
    return deactivated
  })
  await invalidateActiveZonesCache()
  return zone
}

function toFeatureCollection(zones: ZoneRecord[]): ZoneFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      id: zone.id,
      geometry: zone.geometry,
      properties: {
        id: zone.id,
        name: zone.name,
        type: zone.type,
        color: zone.color,
        isActive: zone.isActive,
        updatedAt: zone.updatedAt,
      },
    })),
  }
}

export async function getActiveZonesGeoJson(toleranceM: number): Promise<ZoneFeatureCollection> {
  if (toleranceM === 0 && redisClient.isReady) {
    try {
      const cached = await redisClient.get(activeZoneCacheKey)
      if (cached) return JSON.parse(cached) as ZoneFeatureCollection
    } catch {
      // Fall through to PostGIS when Redis is unavailable or the cache is malformed.
    }
  }

  const collection = toFeatureCollection(await listActiveZonesGeoJson(toleranceM))
  if (toleranceM === 0 && redisClient.isReady) {
    try {
      await redisClient.set(activeZoneCacheKey, JSON.stringify(collection), { EX: 300 })
    } catch {
      // The zone endpoint remains available when the optional cache is unavailable.
    }
  }
  return collection
}

export async function checkZonesAtPoint(lng: number, lat: number) {
  return findZonesContainingPoint(lng, lat)
}
