import type { VehicleType } from '@routecommand/shared'
import type { QueryResultRow } from 'pg'

import type { DatabaseExecutor } from '../../db/pool.js'
import { query } from '../../db/pool.js'

export interface VehicleRecord {
  id: string
  plate: string
  type: VehicleType
  capacityKg: number
  isActive: boolean
  assignedDriverId: string | null
  assignedDriverName: string | null
  assignedDriverStatus: string | null
  createdAt: string
  updatedAt: string
}

interface VehicleRow extends QueryResultRow {
  id: string
  plate: string
  type: VehicleType
  capacity_kg: number
  is_active: boolean
  assigned_driver_id: string | null
  assigned_driver_name: string | null
  assigned_driver_status: string | null
  created_at: Date
  updated_at: Date
}

function mapVehicle(row: VehicleRow): VehicleRecord {
  return {
    id: row.id,
    plate: row.plate,
    type: row.type,
    capacityKg: Number(row.capacity_kg),
    isActive: row.is_active,
    assignedDriverId: row.assigned_driver_id,
    assignedDriverName: row.assigned_driver_name,
    assignedDriverStatus: row.assigned_driver_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

const selectVehicle = `
  SELECT v.id, v.plate::text AS plate, v.type, v.capacity_kg::float8 AS capacity_kg,
         v.is_active,
         assigned.id AS assigned_driver_id,
         assigned.name AS assigned_driver_name,
         assigned.status AS assigned_driver_status,
         v.created_at, v.updated_at
  FROM vehicles v
  LEFT JOIN LATERAL (
    SELECT d.id, u.name, d.status
    FROM drivers d
    JOIN users u ON u.id = d.user_id
    WHERE d.vehicle_id = v.id AND u.is_active = true
    ORDER BY (d.status = 'OFFLINE') ASC, d.created_at, d.id
    LIMIT 1
  ) assigned ON true`

export async function listVehicles(input: {
  search?: string | undefined
  type?: VehicleType | undefined
  active?: boolean | undefined
  limit: number
  offset: number
}): Promise<VehicleRecord[]> {
  const result = await query<VehicleRow>(
    `${selectVehicle}
     WHERE ($1::text IS NULL OR v.plate::text ILIKE '%' || $1 || '%')
       AND ($2::vehicle_type IS NULL OR v.type = $2::vehicle_type)
       AND ($3::boolean IS NULL OR v.is_active = $3)
     ORDER BY v.created_at DESC, v.id
     LIMIT $4 OFFSET $5`,
    [input.search ?? null, input.type ?? null, input.active ?? null, input.limit, input.offset],
  )
  return result.rows.map(mapVehicle)
}

export async function getVehicle(id: string, executor = { query }): Promise<VehicleRecord | null> {
  const result = await executor.query<VehicleRow>(`${selectVehicle} WHERE v.id = $1`, [id])
  return result.rows[0] ? mapVehicle(result.rows[0]) : null
}

export async function lockVehicle(id: string, executor: DatabaseExecutor) {
  const result = await executor.query<{ id: string; is_active: boolean }>(
    'SELECT id, is_active FROM vehicles WHERE id = $1 FOR UPDATE',
    [id],
  )
  return result.rows[0] ?? null
}

export async function hasActiveDriverAssignment(
  vehicleId: string,
  executor: DatabaseExecutor,
): Promise<boolean> {
  const result = await executor.query<{ assigned: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM drivers
       WHERE vehicle_id = $1 AND status <> 'OFFLINE'
     ) AS assigned`,
    [vehicleId],
  )
  return result.rows[0]?.assigned ?? false
}

export async function insertVehicle(
  input: { plate: string; type: VehicleType; capacityKg: number },
  executor: DatabaseExecutor,
): Promise<VehicleRecord> {
  const result = await executor.query<VehicleRow>(
    `INSERT INTO vehicles (plate, type, capacity_kg)
     VALUES ($1, $2, $3)
     RETURNING id, plate::text AS plate, type, capacity_kg::float8 AS capacity_kg,
               is_active, NULL::uuid AS assigned_driver_id, NULL::text AS assigned_driver_name,
               NULL::driver_status AS assigned_driver_status, created_at, updated_at`,
    [input.plate, input.type, input.capacityKg],
  )
  return mapVehicle(result.rows[0]!)
}

export async function patchVehicle(
  id: string,
  patch: {
    plate?: string | undefined
    type?: VehicleType | undefined
    capacityKg?: number | undefined
    isActive?: boolean | undefined
  },
  executor: DatabaseExecutor,
): Promise<VehicleRecord | null> {
  const values: unknown[] = [id]
  const sets: string[] = []
  const columns: [keyof typeof patch, string][] = [
    ['plate', 'plate'],
    ['type', 'type'],
    ['capacityKg', 'capacity_kg'],
    ['isActive', 'is_active'],
  ]
  for (const [key, column] of columns) {
    if (patch[key] === undefined) continue
    values.push(patch[key])
    sets.push(`${column} = $${values.length}`)
  }
  const result = await executor.query<VehicleRow>(
    `${selectVehicle} WHERE v.id = $1 FOR UPDATE OF v`,
    [id],
  )
  if (!result.rows[0]) return null
  if (sets.length) {
    await executor.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, values)
  }
  const updated = await executor.query<VehicleRow>(`${selectVehicle} WHERE v.id = $1`, [id])
  return updated.rows[0] ? mapVehicle(updated.rows[0]) : null
}
