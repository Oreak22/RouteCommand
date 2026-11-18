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
  isDriverDispatchEligible,
  listShipmentCustomers,
  listDispatchCandidates,
  listShipmentEvents,
  lockTimedOutAssignments,
  listShipments,
  lockDriverForShipment,
  lockShipment,
  patchShipment,
  saveIdempotentResponse,
  setShipmentStatus,
  updateLockedDriverStatus,
} from './repository.js'
import type { DispatchCandidate, ShipmentEventRecord, ShipmentRecord } from './repository.js'
import {
  assertShipmentTransition,
  assertSystemShipmentTransition,
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
  actorId: string | null,
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
        const createdEvent = await insertShipmentEvent(
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
            eventId: createdEvent.id,
          })
          domainEventBus.publishAfterCommit(afterCommit, 'security.signal', {
            type: 'customer_shipment_created',
            userId: actor.id,
            occurredAt: new Date().toISOString(),
            evidence: { shipmentId },
            ...(context.ip ? { ip: context.ip } : {}),
            ...(context.userAgent ? { userAgent: context.userAgent } : {}),
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

export async function getDispatchSuggestions(
  shipmentId: string,
  actor: { id: string; role: UserRole },
): Promise<DispatchCandidate[]> {
  if (!['ADMIN', 'DISPATCHER'].includes(actor.role)) {
    throw new ForbiddenError('Only dispatchers and administrators can request driver suggestions.')
  }
  const shipment = await getShipmentRecord(shipmentId, actor)
  if (shipment.status !== 'CREATED') {
    throw new ConflictError('Driver suggestions are available only for unassigned shipments.', {
      status: shipment.status,
    })
  }
  return listDispatchCandidates({
    shipmentId,
    radiusM: env.DISPATCH_PICKUP_RADIUS_M,
    signalStaleSeconds: env.DRIVER_SIGNAL_STALE_SECONDS,
    maxAccuracyM: env.MAX_ACCURACY_M,
    workloadPenaltyM: env.DISPATCH_WORKLOAD_PENALTY_M,
    freshnessPenaltyMPerMinute: env.DISPATCH_FRESHNESS_PENALTY_M_PER_MINUTE,
    zoneMatchBonusM: env.DISPATCH_ZONE_MATCH_BONUS_M,
  })
}

export async function assignShipmentToDriverRecord(
  shipmentId: string,
  driverId: string,
  actor: { id: string; role: UserRole },
  context: AuthRequestContext,
): Promise<{ shipment: ShipmentRecord; event: ShipmentEventRecord }> {
  if (!['ADMIN', 'DISPATCHER'].includes(actor.role)) {
    throw new ForbiddenError('Only dispatchers and administrators can assign shipments.')
  }
  return withTransaction(async (executor, afterCommit) => {
    const locked = await lockShipment(shipmentId, executor)
    if (!locked) throw new NotFoundError('Shipment was not found.')
    if (locked.status !== 'CREATED') {
      throw new ConflictError('Only unassigned shipments can be dispatched.', {
        status: locked.status,
      })
    }
    const driver = await assertDriverCanBeAssigned(driverId, null, executor)
    if (driver.status !== 'AVAILABLE') {
      throw new ConflictError('The selected driver is no longer available.', {
        reason: 'DRIVER_NOT_AVAILABLE',
      })
    }
    const shipmentBefore = await getShipment(shipmentId, executor)
    if (!shipmentBefore) throw new NotFoundError('Shipment was not found.')
    const eligible = await isDriverDispatchEligible(
      shipmentId,
      driverId,
      {
        radiusM: env.DISPATCH_PICKUP_RADIUS_M,
        signalStaleSeconds: env.DRIVER_SIGNAL_STALE_SECONDS,
        maxAccuracyM: env.MAX_ACCURACY_M,
      },
      executor,
    )
    if (!eligible) {
      throw new ConflictError('The selected driver no longer meets dispatch requirements.', {
        reason: 'DRIVER_NO_LONGER_ELIGIBLE',
      })
    }
    if (
      !driver.vehicle_active ||
      driver.capacity_kg === null ||
      driver.capacity_kg < shipmentBefore.weightKg
    ) {
      throw new ConflictError('The selected driver vehicle cannot carry this shipment.', {
        reason: 'INSUFFICIENT_VEHICLE_CAPACITY',
      })
    }
    await patchShipment(shipmentId, { driverId }, executor)
    const shipment = await getShipment(shipmentId, executor)
    if (!shipment) throw new NotFoundError('Shipment was not found after assignment.')
    assertShipmentTransition(locked.status, 'ASSIGNED', actor.role, false)
    return saveTransition(
      shipment,
      locked.status,
      'ASSIGNED',
      actor,
      'Assigned by dispatch.',
      null,
      context,
      executor,
      afterCommit,
    )
  })
}

function distanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const radians = Math.PI / 180
  const latitudeDelta = (to.lat - from.lat) * radians
  const longitudeDelta = (to.lng - from.lng) * radians
  const latitudeA = from.lat * radians
  const latitudeB = to.lat * radians
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export async function assignShipmentBatchToDriverRecord(
  shipmentIds: string[],
  driverId: string,
  actor: { id: string; role: UserRole },
  context: AuthRequestContext,
): Promise<{
  driverId: string
  totalWeightKg: number
  stops: Array<{
    sequence: number
    distanceFromPreviousM: number
    shipment: ShipmentRecord
    event: ShipmentEventRecord
  }>
}> {
  if (!['ADMIN', 'DISPATCHER'].includes(actor.role)) {
    throw new ForbiddenError('Only dispatchers and administrators can batch-assign shipments.')
  }
  if (shipmentIds.length < 2 || new Set(shipmentIds).size !== shipmentIds.length) {
    throw new ValidationError({ shipmentIds: ['Choose at least two distinct shipments.'] })
  }

  return withTransaction(async (executor, afterCommit) => {
    const lockedById = new Map<string, Awaited<ReturnType<typeof lockShipment>>>()
    for (const shipmentId of [...shipmentIds].sort()) {
      const locked = await lockShipment(shipmentId, executor)
      if (!locked) throw new NotFoundError('One or more shipments were not found.')
      if (locked.status !== 'CREATED') {
        throw new ConflictError('Every batch shipment must be unassigned.', {
          shipmentId,
          status: locked.status,
        })
      }
      lockedById.set(shipmentId, locked)
    }

    const shipments = await Promise.all(
      shipmentIds.map(async (shipmentId) => {
        const shipment = await getShipment(shipmentId, executor)
        if (!shipment) throw new NotFoundError('One or more shipments were not found.')
        return shipment
      }),
    )
    const totalWeightKg = shipments.reduce((total, shipment) => total + shipment.weightKg, 0)
    const driver = await assertDriverCanBeAssigned(driverId, null, executor)
    if (driver.status !== 'AVAILABLE') {
      throw new ConflictError('The selected driver is no longer available.', {
        reason: 'DRIVER_NOT_AVAILABLE',
      })
    }
    if (
      !driver.vehicle_active ||
      driver.capacity_kg === null ||
      driver.capacity_kg < totalWeightKg
    ) {
      throw new ConflictError('The selected vehicle cannot carry the combined shipment weight.', {
        reason: 'INSUFFICIENT_BATCH_CAPACITY',
        totalWeightKg,
        capacityKg: driver.capacity_kg,
      })
    }
    if (driver.lat === null || driver.lng === null) {
      throw new ConflictError('The selected driver has no current location.', {
        reason: 'DRIVER_NO_LOCATION',
      })
    }

    for (const shipment of shipments) {
      const eligible = await isDriverDispatchEligible(
        shipment.id,
        driverId,
        {
          radiusM: env.DISPATCH_PICKUP_RADIUS_M,
          signalStaleSeconds: env.DRIVER_SIGNAL_STALE_SECONDS,
          maxAccuracyM: env.MAX_ACCURACY_M,
        },
        executor,
      )
      if (!eligible) {
        throw new ConflictError(
          'The selected driver is not eligible for every shipment in this batch.',
          {
            shipmentId: shipment.id,
            reason: 'DRIVER_NO_LONGER_ELIGIBLE',
          },
        )
      }
    }

    const remaining = [...shipments]
    const ordered: Array<{ shipment: ShipmentRecord; distanceFromPreviousM: number }> = []
    let previous = { lat: driver.lat, lng: driver.lng }
    while (remaining.length > 0) {
      let nearestIndex = 0
      let nearestDistance = distanceMeters(previous, remaining[0]!.pickup)
      for (let index = 1; index < remaining.length; index += 1) {
        const candidateDistance = distanceMeters(previous, remaining[index]!.pickup)
        if (candidateDistance < nearestDistance) {
          nearestDistance = candidateDistance
          nearestIndex = index
        }
      }
      const [nearest] = remaining.splice(nearestIndex, 1)
      ordered.push({ shipment: nearest!, distanceFromPreviousM: nearestDistance })
      previous = nearest!.pickup
    }

    const stops = []
    for (const [index, stop] of ordered.entries()) {
      const locked = lockedById.get(stop.shipment.id)!
      await patchShipment(stop.shipment.id, { driverId }, executor)
      const assigned = await getShipment(stop.shipment.id, executor)
      if (!assigned) throw new NotFoundError('A shipment was not found after batch assignment.')
      assertShipmentTransition(locked.status, 'ASSIGNED', actor.role, false)
      const result = await saveTransition(
        assigned,
        locked.status,
        'ASSIGNED',
        actor,
        `Assigned in batch dispatch · stop ${index + 1} of ${ordered.length}.`,
        null,
        context,
        executor,
        afterCommit,
      )
      stops.push({
        sequence: index + 1,
        distanceFromPreviousM: Math.round(stop.distanceFromPreviousM),
        shipment: result.shipment,
        event: result.event,
      })
    }
    return { driverId, totalWeightKg, stops }
  })
}

export async function requeueTimedOutAssignments(shipmentId?: string): Promise<number> {
  return withTransaction(async (executor, afterCommit) => {
    const timedOut = await lockTimedOutAssignments(
      env.DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS,
      50,
      executor,
      shipmentId,
    )
    for (const record of timedOut) {
      assertSystemShipmentTransition('ASSIGNED', 'CREATED')
      await setShipmentStatus(record.id, 'CREATED', executor, true)
      const timeoutEvent = await insertShipmentEvent(
        {
          shipmentId: record.id,
          status: 'CREATED',
          actorId: null,
          note: 'Assignment expired before driver acceptance; returned to dispatch queue.',
          location: null,
        },
        executor,
      )
      await writeAudit(
        executor,
        null,
        'shipments.assignment_timed_out',
        record.id,
        { ip: undefined, userAgent: undefined },
        {
          previousStatus: 'ASSIGNED',
          status: 'CREATED',
          driverId: record.driver_id,
          timeoutSeconds: env.DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS,
        },
      )
      await setDriverOperationalStatus(
        record.driver_id,
        record.id,
        'AVAILABLE',
        null,
        executor,
        afterCommit,
      )
      domainEventBus.publishAfterCommit(afterCommit, 'shipment.statusChanged', {
        shipmentId: record.id,
        eventId: timeoutEvent.id,
        previousStatus: 'ASSIGNED',
        status: 'CREATED',
        actorId: null,
      })
    }
    return timedOut.length
  })
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
  actorId: string | null,
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
      eventId: event.id,
      driverId: shipment.driverId,
      dispatcherId: actor.id,
      trackingCode: shipment.trackingCode,
    })
  } else if (toStatus !== 'CANCELLED') {
    domainEventBus.publishAfterCommit(afterCommit, 'shipment.statusChanged', {
      shipmentId: shipment.id,
      eventId: event.id,
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
      previousStatus: locked.status,
      previousDriverId: shipment.driverId,
      eventId: result.event.id,
    })
    if (actor.role === 'CUSTOMER') {
      domainEventBus.publishAfterCommit(afterCommit, 'security.signal', {
        type: 'customer_shipment_cancelled',
        userId: actor.id,
        occurredAt: new Date().toISOString(),
        evidence: { shipmentId },
        ...(context.ip ? { ip: context.ip } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      })
    }
    return result
  })
}
