import type {
  CreateZoneInput,
  ListZonesQuery,
  UpdateZoneInput,
  ZoneGeometry,
  ZoneType,
} from '@routecommand/shared'
import type { QueryResultRow } from 'pg'

import type { DatabaseExecutor } from '../../db/pool.js'
import { query } from '../../db/pool.js'

export interface ZoneRecord {
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

interface ZoneRow extends QueryResultRow {
  id: string
  name: string
  type: ZoneType
  geometry: ZoneGeometry
  color: string
  is_active: boolean
  created_by: string | null
  created_at: Date
  updated_at: string
}

function mapZone(row: ZoneRow): ZoneRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    geometry: row.geometry,
    color: row.color,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at,
  }
}

const selectZone = `
  SELECT id, name, type, ST_AsGeoJSON(geom::geometry)::json AS geometry, color,
         is_active, created_by, created_at,
         to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
  FROM zones`

export async function listZones(input: ListZonesQuery): Promise<ZoneRecord[]> {
  const result = await query<ZoneRow>(
    `${selectZone}
     WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
       AND ($2::zone_type IS NULL OR type = $2::zone_type)
       AND ($3::boolean IS NULL OR is_active = $3)
     ORDER BY name, type, id
     LIMIT $4 OFFSET $5`,
    [input.search ?? null, input.type ?? null, input.active ?? null, input.limit, input.offset],
  )
  return result.rows.map(mapZone)
}

export async function getZone(id: string, executor: DatabaseExecutor = { query }) {
  const result = await executor.query<ZoneRow>(`${selectZone} WHERE id = $1`, [id])
  return result.rows[0] ? mapZone(result.rows[0]) : null
}

export async function lockZone(id: string, executor: DatabaseExecutor) {
  const result = await executor.query<{ id: string; updated_at: string }>(
    `SELECT id, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
     FROM zones WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function validateZoneGeometry(geometry: ZoneGeometry) {
  const result = await query<{
    is_valid: boolean
    validity_reason: string
    area_m2: number | null
  }>(
    `WITH candidate AS (
       SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS geom
     )
     SELECT ST_IsValid(geom) AS is_valid,
            ST_IsValidReason(geom) AS validity_reason,
            CASE WHEN ST_IsValid(geom) THEN ST_Area(geom::geography)::float8 END AS area_m2
     FROM candidate`,
    [JSON.stringify(geometry)],
  )
  return result.rows[0]!
}

export async function insertZone(
  input: CreateZoneInput,
  actorId: string,
  executor: DatabaseExecutor,
): Promise<ZoneRecord> {
  const result = await executor.query<ZoneRow>(
    `INSERT INTO zones (name, type, geom, color, is_active, created_by)
     VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))::geography, $4, $5, $6)
     RETURNING id, name, type, ST_AsGeoJSON(geom::geometry)::json AS geometry, color,
               is_active, created_by, created_at,
               to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
    [input.name, input.type, JSON.stringify(input.geometry), input.color, input.isActive, actorId],
  )
  return mapZone(result.rows[0]!)
}

export async function updateZone(
  id: string,
  input: UpdateZoneInput,
  executor: DatabaseExecutor,
): Promise<ZoneRecord | null> {
  const values: unknown[] = [id]
  const sets: string[] = []
  const columns: [keyof UpdateZoneInput, string][] = [
    ['name', 'name'],
    ['type', 'type'],
    ['color', 'color'],
    ['isActive', 'is_active'],
  ]

  for (const [key, column] of columns) {
    const value = input[key]
    if (value === undefined || key === 'expectedUpdatedAt') continue
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }
  if (input.geometry) {
    values.push(JSON.stringify(input.geometry))
    sets.push(`geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${values.length}), 4326))::geography`)
  }
  values.push(input.expectedUpdatedAt)

  const result = await executor.query<ZoneRow>(
    `UPDATE zones SET ${sets.join(', ')}
     WHERE id = $1 AND updated_at = $${values.length}::timestamptz
     RETURNING id, name, type, ST_AsGeoJSON(geom::geometry)::json AS geometry, color,
               is_active, created_by, created_at,
               to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
    values,
  )
  return result.rows[0] ? mapZone(result.rows[0]) : null
}

export async function deactivateZone(
  id: string,
  expectedUpdatedAt: string,
  executor: DatabaseExecutor,
): Promise<ZoneRecord | null> {
  const result = await executor.query<ZoneRow>(
    `UPDATE zones SET is_active = false
     WHERE id = $1 AND updated_at = $2::timestamptz AND is_active = true
     RETURNING id, name, type, ST_AsGeoJSON(geom::geometry)::json AS geometry, color,
               is_active, created_by, created_at,
               to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
    [id, expectedUpdatedAt],
  )
  return result.rows[0] ? mapZone(result.rows[0]) : null
}

export async function listActiveZonesGeoJson(toleranceM: number): Promise<ZoneRecord[]> {
  const result = await query<ZoneRow>(
    `SELECT id, name, type,
       CASE WHEN $1::float8 = 0 THEN ST_AsGeoJSON(geom::geometry)::json
            ELSE ST_AsGeoJSON(ST_Transform(
              ST_SimplifyPreserveTopology(ST_Transform(geom::geometry, 3857), $1), 4326
            ))::json
       END AS geometry,
       color, is_active, created_by, created_at,
       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
     FROM zones WHERE is_active = true ORDER BY name, type, id`,
    [toleranceM],
  )
  return result.rows.map(mapZone)
}

export async function findZonesContainingPoint(lng: number, lat: number) {
  const result = await query<Pick<ZoneRow, 'id' | 'name' | 'type' | 'color'>>(
    `SELECT id, name, type, color FROM zones
     WHERE is_active = true
       AND ST_Covers(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
     ORDER BY name, type, id`,
    [lng, lat],
  )
  return result.rows
}
