import type {
  DriverStatus,
  ListDriversQuery,
  NearbyDriversQuery,
  UpdateDriverInput,
} from '@routecommand/shared'

import {
  assignVehicle as persistVehicleAssignment,
  countActiveShipments,
  getDriver,
  getDriverByUserId,
  getTelemetryIdentityByUserId,
  hasOtherActiveVehicleAssignment,
  listDrivers,
  listNearbyDrivers,
  lockDriver,
  updateDriver,
  updateDriverStatus,
  type DriverRecord,
} from './repository.js'
import { env } from '../../config/env.js'
import { ConflictError, NotFoundError } from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { withTransaction, type DatabaseExecutor, type RegisterAfterCommit } from '../../db/pool.js'
import type { AuthRequestContext } from '../auth/types.js'
import { lockVehicle } from '../vehicles/repository.js'

export type DriverView = DriverRecord & { signalState: 'NO_SIGNAL' | 'SIGNAL_LOST' | 'LIVE' }

function withSignalState(driver: DriverRecord): DriverView {
  if (!driver.lastSeenAt) return { ...driver, signalState: 'NO_SIGNAL' }
  const ageMs = Date.now() - new Date(driver.lastSeenAt).getTime()
  return {
    ...driver,
    signalState: ageMs > env.DRIVER_SIGNAL_STALE_SECONDS * 1_000 ? 'SIGNAL_LOST' : 'LIVE',
  }
}

export async function listDriverRecords(input: ListDriversQuery): Promise<DriverView[]> {
  return (await listDrivers(input)).map(withSignalState)
}

export async function listNearbyDriverRecords(input: NearbyDriversQuery): Promise<DriverView[]> {
  return (await listNearbyDrivers(input)).map(withSignalState)
}

export async function getDriverRecord(driverId: string): Promise<DriverView> {
  const driver = await getDriver(driverId)
  if (!driver) throw new NotFoundError('Driver was not found.')
  return withSignalState(driver)
}

export async function getCurrentDriverRecord(userId: string): Promise<DriverView> {
  const driver = await getDriverByUserId(userId)
  if (!driver) throw new NotFoundError('Driver profile was not found.')
  return withSignalState(driver)
}

export function resolveTelemetryIdentityForUser(userId: string) {
  return getTelemetryIdentityByUserId(userId)
}

async function auditDriverChange(
  executor: DatabaseExecutor,
  actorId: string,
  driverId: string,
  action: string,
  context: AuthRequestContext,
  metadata: Record<string, unknown>,
): Promise<void> {
  await executor.query(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
     VALUES ($1, $2, 'driver', $3, $4::jsonb, $5)`,
    [actorId, action, driverId, JSON.stringify(metadata), context.ip ?? null],
  )
}

function publishStatusChanged(
  afterCommit: RegisterAfterCommit,
  driver: { id: string; user_id: string; status: DriverStatus },
  previousStatus: DriverStatus,
  actorId: string,
): void {
  if (previousStatus === driver.status) return
  domainEventBus.publishAfterCommit(afterCommit, 'driver.statusChanged', {
    driverId: driver.id,
    userId: driver.user_id,
    previousStatus,
    status: driver.status,
    occurredAt: new Date().toISOString(),
    actorId,
  })
}

async function ensureVehicleCanBeUsed(
  driverId: string,
  vehicleId: string | null,
  executor: DatabaseExecutor,
): Promise<void> {
  if (!vehicleId) return
  if (await hasOtherActiveVehicleAssignment(vehicleId, driverId, executor)) {
    throw new ConflictError('That vehicle is already assigned to an active driver.', {
      reason: 'VEHICLE_ALREADY_ASSIGNED',
    })
  }
}

async function assertNoActiveShipmentsWhenGoingOffline(
  driverId: string,
  status: DriverStatus,
  force: boolean,
  executor: DatabaseExecutor,
): Promise<void> {
  if (status !== 'OFFLINE') return
  const activeShipmentCount = await countActiveShipments(driverId, executor)
  if (activeShipmentCount > 0 && !force) {
    throw new ConflictError('This driver has active shipments. Confirm before going offline.', {
      reason: 'ACTIVE_SHIPMENTS',
      activeShipmentCount,
      forceRequired: true,
    })
  }
}

async function applyStatus(
  executor: DatabaseExecutor,
  afterCommit: RegisterAfterCommit,
  driver: { id: string; user_id: string; status: DriverStatus; vehicle_id: string | null },
  status: Exclude<DriverStatus, 'BUSY'>,
  force: boolean,
  actorId: string,
  context: AuthRequestContext,
): Promise<void> {
  if (driver.status === status) return
  await assertNoActiveShipmentsWhenGoingOffline(driver.id, status, force, executor)
  if (status !== 'OFFLINE') await ensureVehicleCanBeUsed(driver.id, driver.vehicle_id, executor)
  const updated = await updateDriverStatus(driver.id, status, executor)
  if (!updated) throw new NotFoundError('Driver was not found.')
  await auditDriverChange(executor, actorId, driver.id, 'drivers.status_changed', context, {
    previousStatus: driver.status,
    status,
    force,
  })
  if (status === 'OFFLINE') {
    const ended = await executor.query<{ id: string; shipment_id: string }>(
      `UPDATE navigation_sessions SET status = 'CANCELLED', ended_at = now()
        WHERE driver_id = $1 AND status IN ('PLANNED','ACTIVE','OFF_ROUTE','REROUTING')
        RETURNING id, shipment_id`,
      [driver.id],
    )
    for (const session of ended.rows) {
      domainEventBus.publishAfterCommit(afterCommit, 'navigation.ended', {
        id: session.id,
        driverId: driver.id,
        shipmentId: session.shipment_id,
        reason: 'DRIVER_OFFLINE',
      })
    }
  }
  publishStatusChanged(afterCommit, { ...driver, status: updated.status }, driver.status, actorId)
}

function raiseConflictForUnique(error: unknown): never {
  if (error instanceof Error && 'code' in error && error.code === '23505') {
    throw new ConflictError('The driver license or active vehicle assignment is already in use.')
  }
  throw error
}

export async function updateDriverRecord(
  driverId: string,
  input: UpdateDriverInput,
  actorId: string,
  context: AuthRequestContext,
): Promise<DriverView> {
  try {
    const driver = await withTransaction(async (executor, afterCommit) => {
      const locked = await lockDriver(driverId, executor)
      if (!locked) throw new NotFoundError('Driver was not found.')
      if (input.status !== undefined) {
        await applyStatus(
          executor,
          afterCommit,
          locked,
          input.status,
          input.force ?? false,
          actorId,
          context,
        )
      }
      const updated = await updateDriver(
        driverId,
        input.licenseNo === undefined ? {} : { licenseNo: input.licenseNo },
        executor,
      )
      if (!updated) throw new NotFoundError('Driver was not found.')
      if (input.licenseNo !== undefined) {
        await auditDriverChange(executor, actorId, driverId, 'drivers.license_updated', context, {})
      }
      return updated
    })
    return withSignalState(driver)
  } catch (error) {
    raiseConflictForUnique(error)
  }
}

export async function updateCurrentDriverStatus(
  userId: string,
  status: Exclude<DriverStatus, 'BUSY'>,
  force: boolean,
  context: AuthRequestContext,
): Promise<DriverView> {
  const driver = await getDriverByUserId(userId)
  if (!driver) throw new NotFoundError('Driver profile was not found.')
  return updateDriverRecord(driver.id, { status, force }, userId, context)
}

export async function assignDriverVehicle(
  driverId: string,
  vehicleId: string | null,
  actorId: string,
  context: AuthRequestContext,
): Promise<DriverView> {
  try {
    const driver = await withTransaction(async (executor, afterCommit) => {
      const vehicle = vehicleId ? await lockVehicle(vehicleId, executor) : null
      if (vehicleId && !vehicle) throw new NotFoundError('Vehicle was not found.')
      if (vehicle?.is_active === false) {
        throw new ConflictError('An inactive vehicle cannot be assigned.', {
          reason: 'VEHICLE_INACTIVE',
        })
      }
      const lockedDriver = await lockDriver(driverId, executor)
      if (!lockedDriver) throw new NotFoundError('Driver was not found.')
      if (lockedDriver.vehicle_id === vehicleId) return getDriver(driverId, executor)
      if (vehicleId && lockedDriver.status !== 'OFFLINE') {
        await ensureVehicleCanBeUsed(driverId, vehicleId, executor)
      }
      await persistVehicleAssignment(driverId, vehicleId, executor)
      await executor.query(
        `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
         VALUES ($1, 'drivers.vehicle_assigned', 'driver', $2, $3::jsonb, $4)`,
        [actorId, driverId, JSON.stringify({ vehicleId }), context.ip ?? null],
      )
      domainEventBus.publishAfterCommit(afterCommit, 'driver.vehicleAssigned', {
        driverId,
        vehicleId,
        actorId,
        occurredAt: new Date().toISOString(),
      })
      return getDriver(driverId, executor)
    })
    if (!driver) throw new NotFoundError('Driver was not found.')
    return withSignalState(driver)
  } catch (error) {
    raiseConflictForUnique(error)
  }
}
