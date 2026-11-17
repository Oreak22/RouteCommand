import { createHash, randomBytes } from 'node:crypto'

import type {
  CancelShipmentInput,
  CreateShipmentInput,
  ListShipmentsQuery,
  ShipmentStatus,
  TransitionShipmentInput,
  UpdateShipmentInput,
  UserRole,
} from '@routecommand/shared'

import { etaEstimator } from './eta-estimator.js'
import {
  countOtherActiveShipments,
  getIdempotentResponse,
  getPickupDistance,
  getShipment,
  hasPublicTrackingCode,
  insertShipment,
  insertShipmentEvent,
  listShipmentCustomers,
  listShipmentEvents,
  listShipments,
  lockDriverForShipment,
  lockShipment,
  patchShipment,
  saveIdempotentResponse,
  setShipmentStatus,
  updateLockedDriverStatus,
} from './repository.js'
import type { ShipmentEventRecord, ShipmentRecord } from './repository.js'
import {
  assertShipmentTransition,
  canCancelShipment,
  getAllowedShipmentTransitions,
} from './state-machine.js'
import { env } from '../../config/env.js'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/app-error.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { withTransaction, type DatabaseExecutor, type RegisterAfterCommit } from '../../db/pool.js'
import type { AuthRequestContext } from '../auth/types.js'

const trackingAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function createTrackingCode(): string {
  const bytes = randomBytes(10)
  const suffix = [...bytes].map((byte) => trackingAlphabet[byte & 31]).join('')
  return `RC-${suffix}`
}

function makeRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function writeAudit(
  executor: DatabaseExecutor,
  actorId: string,
  action: string,
  shipmentId: string,
  context: AuthRequestContext,
  metadata: Record<string, unknown>,
): Promise<void> {
  await executor.query(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
     VALUES ($1, $2, 'shipment', $3, $4::jsonb, $5)`,
    [actorId, action, shipmentId, JSON.stringify(metadata), context.ip ?? null],
  )
}

async function assertCustomerAccount(
  customerId: string,
  executor: DatabaseExecutor,
): Promise<void> {
  const result = await executor.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM users WHERE id = $1 AND role = 'CUSTOMER' AND is_active
     ) AS exists`,
    [customerId],
  )
  if (!result.rows[0]?.exists) {
    throw new ValidationError({ customerId: ['An active customer account is required.'] })
  }
}

function raiseTrackingCollision(error: unknown): boolean {
  return (
    error instanceof Error &&
    'constraint' in error &&
    (error as Error & { constraint?: string }).constraint === 'shipments_tracking_code_key'
  )
}

export async function createShipmentRecord(
  input: CreateShipmentInput,
  actor: { id: string; role: UserRole },
  context: AuthRequestContext,
): Promise<ShipmentRecord> {
  const customerId = actor.role === 'CUSTOMER' ? actor.id : input.customerId
  if (!customerId) {
    throw new ValidationError({ customerId: ['Choose the customer for this shipment.'] })
  }
  if (!['CUSTOMER', 'ADMIN', 'DISPATCHER'].includes(actor.role)) {
    throw new ForbiddenError('Drivers cannot create shipments.')
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const trackingCode = createTrackingCode()
    try {
      return await withTransaction(async (executor, afterCommit) => {
        await assertCustomerAccount(customerId, executor)
        const eta = etaEstimator.estimate(input.pickup, input.dropoff)
        const shipmentId = await insertShipment(
          { trackingCode, customerId, payload: input, eta },
          executor,
        )
        await insertShipmentEvent(
          {
            shipmentId,
            status: 'CREATED',
            actorId: actor.id,
            note: actor.role === 'CUSTOMER' ? 'Shipment request created.' : 'Shipment created.',
            location: null,
          },
          executor,
        )
        await writeAudit(executor, actor.id, 'shipments.created', shipmentId, context, {
          customerId,
          trackingCode,
        })
        if (actor.role === 'CUSTOMER') {
          domainEventBus.publishAfterCommit(afterCommit, 'shipment.requested', {
            shipmentId,
            customerId,
            trackingCode,
          })
        }
        const shipment = await getShipment(shipmentId, executor)
        if (!shipment) throw new NotFoundError('Shipment was not found after creation.')
        return shipment
      })
    } catch (error) {
      if (raiseTrackingCollision(error) && attempt < 2) continue
      throw error
    }
  }
  throw new ConflictError('A unique tracking code could not be generated. Try again.')
}

function assertShipmentVisible(
  shipment: ShipmentRecord,
  actor: { id: string; role: UserRole },
): void {
  if (actor.role === 'CUSTOMER' && shipment.customerId !== actor.id) {
    throw new ForbiddenError('You do not have access to this shipment.')
  }
  if (actor.role === 'DRIVER' && shipment.driverUserId !== actor.id) {
    throw new ForbiddenError('You do not have access to this shipment.')
  }
}

export async function listShipmentRecords(
  input: ListShipmentsQuery,
  actor: { id: string; role: UserRole },
): Promise<ShipmentRecord[]> {
  return listShipments(input, actor)
}

export async function publicTrackingCodeExists(trackingCode: string): Promise<boolean> {
  return hasPublicTrackingCode(trackingCode)
}

export async function listShipmentCustomerOptions(input: { search?: string; limit: number }) {
  return listShipmentCustomers(input)
}

export async function getShipmentRecord(
  shipmentId: string,
  actor: { id: string; role: UserRole },
): Promise<ShipmentRecord & { allowedTransitions: ShipmentStatus[]; canCancel: boolean }> {
  const shipment = await getShipment(shipmentId)
  if (!shipment) throw new NotFoundError('Shipment was not found.')
  assertShipmentVisible(shipment, actor)
  const assignedDriver = shipment.driverUserId === actor.id
  const canCancel = canCancelShipment(
    shipment.status,
    actor.role,
    actor.role === 'CUSTOMER' && shipment.customerId === actor.id,
  )
  return {
    ...shipment,
    allowedTransitions: getAllowedShipmentTransitions(shipment.status, actor.role, assignedDriver),
    canCancel,
  }
}

export async function getShipmentEvents(
  shipmentId: string,
  actor: { id: string; role: UserRole },
): Promise<ShipmentEventRecord[]> {
  await getShipmentRecord(shipmentId, actor)
  return listShipmentEvents(shipmentId)
}

async function assertDriverCanBeAssigned(
  driverId: string,
  currentDriverId: string | null,
  executor: DatabaseExecutor,
) {
  const driver = await lockDriverForShipment(driverId, executor)
  if (!driver || !driver.is_active)
    throw new NotFoundError('An active driver profile was not found.')
  if (driver.status !== 'AVAILABLE' && driverId !== currentDriverId) {
    throw new ConflictError('Only an available driver can be assigned.', {
      reason: 'DRIVER_NOT_AVAILABLE',
    })
  }
  const active = await countOtherActiveShipments(
    driverId,
    '00000000-0000-0000-0000-000000000000',
    executor,
  )
  if (active > 0 && driverId !== currentDriverId) {
    throw new ConflictError('The driver already has an active shipment.', {
      reason: 'DRIVER_HAS_ACTIVE_SHIPMENT',
    })
  }
  return driver
}

async function setDriverOperationalStatus(
  driverId: string,
  shipmentId: string,
  status: 'AVAILABLE' | 'BUSY',
  actorId: string,
  executor: DatabaseExecutor,
  afterCommit: RegisterAfterCommit,
): Promise<void> {
  const driver = await lockDriverForShipment(driverId, executor)
  if (!driver) return
  const desired =
    status === 'AVAILABLE'
      ? (await countOtherActiveShipments(driverId, shipmentId, executor)) > 0
        ? 'BUSY'
        : 'AVAILABLE'
      : 'BUSY'
  if (driver.status === desired) return
  const updated = await updateLockedDriverStatus(driverId, desired, executor)
  domainEventBus.publishAfterCommit(afterCommit, 'driver.statusChanged', {
    driverId: updated.id,
    userId: updated.user_id,
    previousStatus: driver.status,
    status: updated.status,
    occurredAt: new Date().toISOString(),
    actorId,
  })
}

function findProximityWarning(
  proximity: { distanceM: number; accuracyM: number | null; recordedAt: Date | null } | null,
): string | null {
  if (!proximity)
    return 'Pickup proximity could not be confirmed because the driver has no recent location.'
  const stale =
    !proximity.recordedAt ||
    Date.now() - proximity.recordedAt.getTime() > env.DRIVER_SIGNAL_STALE_SECONDS * 1_000
  if (stale) return 'Pickup proximity could not be confirmed because the driver location is stale.'
  if (proximity.accuracyM === null || proximity.accuracyM > env.MAX_ACCURACY_M) {
    return 'Pickup proximity could not be confirmed because the latest location accuracy is poor.'
  }
  if (proximity.distanceM > env.PICKUP_PROXIMITY_RADIUS_M) {
    return `Driver is ${Math.round(proximity.distanceM)} m from pickup; expected within ${Math.round(env.PICKUP_PROXIMITY_RADIUS_M)} m.`
  }
  return null
}

export async function updateShipmentRecord(
  shipmentId: string,
  input: UpdateShipmentInput,
  actor: { id: string; role: UserRole },
  context: AuthRequestContext,
): Promise<ShipmentRecord> {
  if (!['ADMIN', 'DISPATCHER'].includes(actor.role)) {
    throw new ForbiddenError('Only dispatchers and administrators may update shipments.')
  }
  return withTransaction(async (executor, afterCommit) => {
    const locked = await lockShipment(shipmentId, executor)
    if (!locked) throw new NotFoundError('Shipment was not found.')
    if (!['CREATED', 'ASSIGNED'].includes(locked.status)) {
      throw new ConflictError('Only shipments that are created or assigned can be edited.', {
        status: locked.status,
      })
    }
    if (locked.status === 'ASSIGNED' && input.driverId === null) {
      throw new ConflictError('Return the shipment to CREATED before removing its assigned driver.')
    }
    if (input.customerId) await assertCustomerAccount(input.customerId, executor)

    let nextDriver = null
    if (
      input.driverId !== undefined &&
      input.driverId !== null &&
      input.driverId !== locked.driver_id
    ) {
      nextDriver = await assertDriverCanBeAssigned(input.driverId, locked.driver_id, executor)
    }

    const before = await getShipment(shipmentId, executor)
    if (!before) throw new NotFoundError('Shipment was not found.')
    const pickup = input.pickup ?? before.pickup
    const dropoff = input.dropoff ?? before.dropoff
    const eta = input.pickup || input.dropoff ? etaEstimator.estimate(pickup, dropoff) : undefined
    await patchShipment(shipmentId, input, executor, eta)

    if (input.driverId !== undefined && input.driverId !== locked.driver_id) {
      if (locked.status === 'ASSIGNED' && locked.driver_id) {
        await setDriverOperationalStatus(
          locked.driver_id,
          shipmentId,
          'AVAILABLE',
          actor.id,
          executor,
          afterCommit,
        )
      }
      if (locked.status === 'ASSIGNED' && input.driverId && nextDriver) {
        const updated = await updateLockedDriverStatus(input.driverId, 'BUSY', executor)
        if (nextDriver.status !== 'BUSY') {
          domainEventBus.publishAfterCommit(afterCommit, 'driver.statusChanged', {
            driverId: updated.id,
            userId: updated.user_id,
            previousStatus: nextDriver.status,
            status: updated.status,
            occurredAt: new Date().toISOString(),
            actorId: actor.id,
          })
        }
      }
    }
    await writeAudit(executor, actor.id, 'shipments.updated', shipmentId, context, {
      fields: Object.keys(input),
    })
    const updated = await getShipment(shipmentId, executor)
    if (!updated) throw new NotFoundError('Shipment was not found after update.')
    return updated
  })
}

async function saveTransition(
  shipment: ShipmentRecord,
  fromStatus: ShipmentStatus,
  toStatus: ShipmentStatus,
  actor: { id: string; role: UserRole },
  note: string | null,
  location: { lat: number; lng: number } | null,
  context: AuthRequestContext,
  executor: DatabaseExecutor,
  afterCommit: RegisterAfterCommit,
  clearDriver = false,
): Promise<{ shipment: ShipmentRecord; event: ShipmentEventRecord }> {
  await setShipmentStatus(shipment.id, toStatus, executor, clearDriver)
  const event = await insertShipmentEvent(
    { shipmentId: shipment.id, status: toStatus, actorId: actor.id, note, location },
    executor,
  )
  await writeAudit(
    executor,
    actor.id,
    `shipments.${toStatus.toLowerCase()}`,
    shipment.id,
    context,
    {
      previousStatus: fromStatus,
      status: toStatus,
    },
  )

  if (shipment.driverId) {
    if (
      toStatus === 'ASSIGNED' ||
      toStatus === 'ACCEPTED' ||
      toStatus === 'PICKED_UP' ||
      toStatus === 'IN_TRANSIT' ||
      toStatus === 'ARRIVED' ||
      toStatus === 'FAILED_DELIVERY'
    ) {
      await setDriverOperationalStatus(
        shipment.driverId,
        shipment.id,
        'BUSY',
        actor.id,
        executor,
        afterCommit,
      )
    } else if (
      toStatus === 'CREATED' ||
      toStatus === 'DELIVERED' ||
      toStatus === 'CANCELLED' ||
      toStatus === 'RETURNED'
    ) {
      await setDriverOperationalStatus(
        shipment.driverId,
        shipment.id,
        'AVAILABLE',
        actor.id,
        executor,
        afterCommit,
      )
    }
  }

  const updated = await getShipment(shipment.id, executor)
  if (!updated) throw new NotFoundError('Shipment was not found after transition.')
  if (toStatus === 'ASSIGNED' && shipment.driverId) {
    domainEventBus.publishAfterCommit(afterCommit, 'shipment.assigned', {
      shipmentId: shipment.id,
      driverId: shipment.driverId,
      dispatcherId: actor.id,
      trackingCode: shipment.trackingCode,
    })
  } else if (toStatus !== 'CANCELLED') {
    domainEventBus.publishAfterCommit(afterCommit, 'shipment.statusChanged', {
      shipmentId: shipment.id,
      previousStatus: fromStatus,
      status: toStatus,
      actorId: actor.id,
    })
  }
  return { shipment: updated, event }
}

export async function transitionShipmentRecord(
  shipmentId: string,
  input: TransitionShipmentInput,
  actor: { id: string; role: UserRole },
  context: AuthRequestContext,
  idempotencyKey?: string,
): Promise<{ shipment: ShipmentRecord; event: ShipmentEventRecord }> {
  return withTransaction(async (executor, afterCommit) => {
    const locked = await lockShipment(shipmentId, executor)
    if (!locked) throw new NotFoundError('Shipment was not found.')
    const shipment = await getShipment(shipmentId, executor)
    if (!shipment) throw new NotFoundError('Shipment was not found.')
    assertShipmentVisible(shipment, actor)

    const requestHash = makeRequestHash(input)
    if (idempotencyKey) {
      const previous = await getIdempotentResponse(shipmentId, idempotencyKey, executor)
      if (previous) {
        if (previous.requestHash !== requestHash) {
          throw new ConflictError(
            'The idempotency key was already used for a different transition.',
          )
        }
        return previous.response as { shipment: ShipmentRecord; event: ShipmentEventRecord }
      }
    }

    const assignedDriver = shipment.driverUserId === actor.id
    assertShipmentTransition(locked.status, input.toStatus, actor.role, assignedDriver)

    if (input.toStatus === 'ASSIGNED') {
      if (!shipment.driverId) {
        throw new ConflictError('Choose a driver before assigning the shipment.', {
          reason: 'DRIVER_REQUIRED',
        })
      }
      const driver = await assertDriverCanBeAssigned(shipment.driverId, null, executor)
      if (driver.status !== 'AVAILABLE') {
        throw new ConflictError('The assigned driver is no longer available.')
      }
    }

    let note = input.note ?? null
    if (input.toStatus === 'PICKED_UP') {
      const proximity = await getPickupDistance(shipment.driverId!, shipment.id, executor)
      const warning = findProximityWarning(proximity)
      if (warning && env.PICKUP_PROXIMITY_MODE === 'STRICT') {
        throw new ConflictError(
          'Pickup cannot be confirmed because the driver is not close enough.',
          {
            reason: 'PICKUP_PROXIMITY',
            warning,
            radiusM: env.PICKUP_PROXIMITY_RADIUS_M,
          },
        )
      }
      if (warning) note = [note, warning].filter(Boolean).join('\n')
    }

    const clearDriver = input.toStatus === 'CREATED'
    const result = await saveTransition(
      shipment,
      locked.status,
      input.toStatus,
      actor,
      note,
      input.location ?? null,
      context,
      executor,
      afterCommit,
      clearDriver,
    )
    if (idempotencyKey) {
      await saveIdempotentResponse(shipmentId, idempotencyKey, requestHash, result, executor)
    }
    return result
  })
}

export async function cancelShipmentRecord(
  shipmentId: string,
  input: CancelShipmentInput,
  actor: { id: string; role: UserRole },
  context: AuthRequestContext,
): Promise<{ shipment: ShipmentRecord; event: ShipmentEventRecord }> {
  return withTransaction(async (executor, afterCommit) => {
    const locked = await lockShipment(shipmentId, executor)
    if (!locked) throw new NotFoundError('Shipment was not found.')
    const shipment = await getShipment(shipmentId, executor)
    if (!shipment) throw new NotFoundError('Shipment was not found.')
    assertShipmentVisible(shipment, actor)

    const canCancel = canCancelShipment(
      locked.status,
      actor.role,
      actor.role === 'CUSTOMER' && shipment.customerId === actor.id,
    )
    if (!canCancel) {
      throw new ConflictError(
        'This shipment cannot be cancelled by this user in its current status.',
        {
          status: locked.status,
        },
      )
    }

    const result = await saveTransition(
      shipment,
      locked.status,
      'CANCELLED',
      actor,
      input.reason,
      input.location ?? null,
      context,
      executor,
      afterCommit,
      true,
    )
    if (shipment.driverId) {
      await executor.query(
        `UPDATE navigation_sessions SET status = 'CANCELLED', ended_at = now()
         WHERE shipment_id = $1 AND status IN ('PLANNED', 'ACTIVE', 'OFF_ROUTE', 'REROUTING')`,
        [shipment.id],
      )
    }
    domainEventBus.publishAfterCommit(afterCommit, 'shipment.cancelled', {
      shipmentId,
      actorId: actor.id,
      actorRole: actor.role,
      reason: input.reason,
      previousDriverId: shipment.driverId,
    })
    return result
  })
}
