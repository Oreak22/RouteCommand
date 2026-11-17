import type {
  CreateVehicleInput,
  ListVehiclesQuery,
  UpdateVehicleInput,
} from '@routecommand/shared'

import {
  getVehicle,
  hasActiveDriverAssignment,
  insertVehicle,
  listVehicles,
  lockVehicle,
  patchVehicle,
  type VehicleRecord,
} from './repository.js'
import { ConflictError, NotFoundError } from '../../core/errors/app-error.js'
import { withTransaction } from '../../db/pool.js'
import type { AuthRequestContext } from '../auth/types.js'

export async function listVehicleRecords(input: ListVehiclesQuery): Promise<VehicleRecord[]> {
  return listVehicles(input)
}

export async function getVehicleRecord(vehicleId: string): Promise<VehicleRecord> {
  const vehicle = await getVehicle(vehicleId)
  if (!vehicle) throw new NotFoundError('Vehicle was not found.')
  return vehicle
}

export async function createVehicleRecord(
  input: CreateVehicleInput,
  actorId: string,
  context: AuthRequestContext,
): Promise<VehicleRecord> {
  try {
    return await withTransaction(async (executor) => {
      const vehicle = await insertVehicle(input, executor)
      await executor.query(
        `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
         VALUES ($1, 'vehicles.created', 'vehicle', $2, $3::jsonb, $4)`,
        [
          actorId,
          vehicle.id,
          JSON.stringify({ plate: vehicle.plate, type: vehicle.type }),
          context.ip ?? null,
        ],
      )
      return vehicle
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new ConflictError('A vehicle with that plate already exists.')
    }
    throw error
  }
}

export async function updateVehicleRecord(
  vehicleId: string,
  input: UpdateVehicleInput,
  actorId: string,
  context: AuthRequestContext,
): Promise<VehicleRecord> {
  try {
    return await withTransaction(async (executor) => {
      const vehicle = await lockVehicle(vehicleId, executor)
      if (!vehicle) throw new NotFoundError('Vehicle was not found.')
      if (input.isActive === false && (await hasActiveDriverAssignment(vehicleId, executor))) {
        throw new ConflictError('A vehicle assigned to an active driver cannot be deactivated.', {
          reason: 'VEHICLE_HAS_ACTIVE_DRIVER',
        })
      }
      const updated = await patchVehicle(vehicleId, input, executor)
      if (!updated) throw new NotFoundError('Vehicle was not found.')
      await executor.query(
        `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
         VALUES ($1, 'vehicles.updated', 'vehicle', $2, $3::jsonb, $4)`,
        [
          actorId,
          vehicleId,
          JSON.stringify({
            plate: input.plate,
            type: input.type,
            capacityKg: input.capacityKg,
            isActive: input.isActive,
          }),
          context.ip ?? null,
        ],
      )
      return updated
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new ConflictError('A vehicle with that plate already exists.')
    }
    throw error
  }
}

export function deactivateVehicleRecord(
  vehicleId: string,
  actorId: string,
  context: AuthRequestContext,
): Promise<VehicleRecord> {
  return updateVehicleRecord(vehicleId, { isActive: false }, actorId, context)
}
