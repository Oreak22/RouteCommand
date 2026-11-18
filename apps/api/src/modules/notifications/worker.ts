import { getShipmentStatusEmailData } from './shipment-status.js'
import { renderNotice, renderShipmentStatusEmail } from './templates.js'
import { env } from '../../config/env.js'
import { domainEventBus } from '../../core/events/domain-event-bus.js'
import { logger } from '../../core/logger.js'
import { query, withTransaction } from '../../db/pool.js'
import { queueTransactionalEmail } from '../../infra/email-queue.js'
import { listDispatchCandidates } from '../shipments/repository.js'

const customerShipmentStatuses = new Set(['PICKED_UP', 'IN_TRANSIT', 'ARRIVED'])

async function notifyCustomerStatus(event: {
  shipmentId: string
  eventId: string
  status: string
}): Promise<void> {
  if (!customerShipmentStatuses.has(event.status)) return
  const shipment = await getShipmentStatusEmailData(event.shipmentId)
  if (!shipment || !shipment.customerActive || !shipment.customerVerified) return
  const status = event.status as 'PICKED_UP' | 'IN_TRANSIT' | 'ARRIVED'
  const trackingUrl = `${env.WEB_ORIGIN}/track/${encodeURIComponent(shipment.trackingCode)}`
  const rendered = renderShipmentStatusEmail(status, shipment, trackingUrl)
  await withTransaction(async (executor, afterCommit) => {
    await queueTransactionalEmail(executor, afterCommit, {
      userId: shipment.customerId,
      entity: 'shipment',
      entityId: event.shipmentId,
      recipient: shipment.customerEmail,
      template: rendered.template,
      dedupeKey: `shipment:${event.shipmentId}:${event.eventId}:${shipment.customerId}`,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      preferenceType: 'CUSTOMER_SHIPMENT_UPDATES',
      payload: { trackingCode: shipment.trackingCode, status },
    })
  })
}

async function queueRecipientEmail(input: {
  userId: string
  recipient: string
  shipmentId: string
  eventId: string
  template: string
  subject: string
  text: string
  html: string
  preferenceType?: 'DRIVER_REQUEST_INVITATIONS' | 'DISPATCHER_NEW_REQUESTS'
  payload: Record<string, unknown>
}): Promise<void> {
  await withTransaction(async (executor, afterCommit) => {
    await queueTransactionalEmail(executor, afterCommit, {
      userId: input.userId,
      entity: 'shipment',
      entityId: input.shipmentId,
      recipient: input.recipient,
      template: input.template,
      dedupeKey: `shipment:${input.shipmentId}:${input.eventId}:${input.userId}`,
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(input.preferenceType ? { preferenceType: input.preferenceType } : {}),
      payload: input.payload,
    })
  })
}

async function eligibleDispatchers() {
  const result = await query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email::text AS email FROM users
     WHERE role = 'DISPATCHER' AND is_active AND email_verified_at IS NOT NULL
     ORDER BY id`,
  )
  return result.rows
}

async function eligibleDriverRecipients(driverIds: string[]) {
  if (!driverIds.length) return []
  const result = await query<{ id: string; name: string; email: string }>(
    `SELECT u.id, u.name, u.email::text AS email
     FROM drivers d JOIN users u ON u.id = d.user_id
     WHERE d.id = ANY($1::uuid[]) AND u.role = 'DRIVER'
       AND u.is_active AND u.email_verified_at IS NOT NULL
     ORDER BY u.id`,
    [driverIds],
  )
  return result.rows
}

async function notifyNewRequest(event: { shipmentId: string; eventId: string }): Promise<void> {
  const shipment = await getShipmentStatusEmailData(event.shipmentId)
  if (!shipment) return
  const dispatchers = await eligibleDispatchers()
  const trackingUrl = `${env.WEB_ORIGIN}/app/dispatch`
  const commonLines = [
    `Tracking code: ${shipment.trackingCode}`,
    `Pickup: ${shipment.pickupAddress}`,
    `Dropoff: ${shipment.dropoffAddress}`,
    `Weight: ${shipment.weightKg} kg`,
    `Priority: ${shipment.priority.toLowerCase()}`,
    ...(shipment.scheduledAt ? [`Requested time: ${shipment.scheduledAt.toISOString()}`] : []),
  ]
  for (const recipient of dispatchers) {
    const rendered = renderNotice({
      subject: 'New delivery request',
      greeting: recipient.name.split(/\s+/)[0] || 'there',
      lines: commonLines,
      actionLabel: 'Open dispatch board',
      actionUrl: trackingUrl,
    })
    await queueRecipientEmail({
      userId: recipient.id,
      recipient: recipient.email,
      shipmentId: event.shipmentId,
      eventId: event.eventId,
      template: 'shipment_requested_dispatcher',
      ...rendered,
      preferenceType: 'DISPATCHER_NEW_REQUESTS',
      payload: { trackingCode: shipment.trackingCode },
    })
  }

  if (!env.NEW_REQUEST_DRIVER_EMAIL_ENABLED) return
  const candidates = await listDispatchCandidates({
    shipmentId: event.shipmentId,
    radiusM: env.NEW_REQUEST_DRIVER_RADIUS_M,
    signalStaleSeconds: env.DRIVER_SIGNAL_STALE_SECONDS,
    maxAccuracyM: env.MAX_ACCURACY_M,
    workloadPenaltyM: env.DISPATCH_WORKLOAD_PENALTY_M,
    freshnessPenaltyMPerMinute: env.DISPATCH_FRESHNESS_PENALTY_M_PER_MINUTE,
    zoneMatchBonusM: env.DISPATCH_ZONE_MATCH_BONUS_M,
  })
  const nearby = await eligibleDriverRecipients(
    candidates.slice(0, env.NEW_REQUEST_MAX_DRIVERS).map((candidate) => candidate.driverId),
  )
  for (const recipient of nearby) {
    const rendered = renderNotice({
      subject: 'Nearby delivery request',
      greeting: recipient.name.split(/\s+/)[0] || 'there',
      lines: ['This is an invitation to review a nearby job, not an assignment.', ...commonLines],
      actionLabel: 'Review available jobs',
      actionUrl: `${env.WEB_ORIGIN}/driver`,
    })
    await queueRecipientEmail({
      userId: recipient.id,
      recipient: recipient.email,
      shipmentId: event.shipmentId,
      eventId: event.eventId,
      template: 'shipment_requested_driver_invitation',
      ...rendered,
      preferenceType: 'DRIVER_REQUEST_INVITATIONS',
      payload: { trackingCode: shipment.trackingCode },
    })
  }
}

async function notifyAssignedDriver(event: { shipmentId: string; eventId: string }): Promise<void> {
  const shipment = await getShipmentStatusEmailData(event.shipmentId)
  if (
    !shipment?.driverUserId ||
    !shipment.driverEmail ||
    !shipment.driverActive ||
    !shipment.driverVerified
  )
    return
  const rendered = renderNotice({
    subject: 'New job assigned',
    greeting: shipment.driverName?.split(/\s+/)[0] || 'there',
    lines: [
      `Tracking code: ${shipment.trackingCode}`,
      `Pickup: ${shipment.pickupAddress}`,
      `Dropoff: ${shipment.dropoffAddress}`,
      ...(shipment.scheduledAt ? [`Deadline: ${shipment.scheduledAt.toISOString()}`] : []),
    ],
    actionLabel: 'Review and respond to this job',
    actionUrl: `${env.WEB_ORIGIN}/driver/shipments`,
  })
  await queueRecipientEmail({
    userId: shipment.driverUserId,
    recipient: shipment.driverEmail,
    shipmentId: event.shipmentId,
    eventId: event.eventId,
    template: 'shipment_assigned',
    ...rendered,
    payload: { trackingCode: shipment.trackingCode },
  })
}

async function notifyCancellation(event: {
  shipmentId: string
  eventId: string
  actorRole: string
  previousStatus: string
  reason: string
}): Promise<void> {
  const shipment = await getShipmentStatusEmailData(event.shipmentId)
  if (!shipment) return
  const lines = [
    `Tracking code: ${shipment.trackingCode}`,
    `Reason: ${event.reason}`,
    `Previous state: ${event.previousStatus.toLowerCase().replaceAll('_', ' ')}`,
    shipment.driverUserId ? 'A driver had already been assigned.' : 'No driver had been assigned.',
  ]
  const recipients: Array<{ id: string; name: string; email: string }> = []
  if (event.actorRole === 'CUSTOMER') {
    recipients.push(...(await eligibleDispatchers()))
  } else if (shipment.customerActive && shipment.customerVerified) {
    recipients.push({
      id: shipment.customerId,
      name: shipment.customerName,
      email: shipment.customerEmail,
    })
  }
  if (
    shipment.driverUserId &&
    shipment.driverEmail &&
    shipment.driverActive &&
    shipment.driverVerified
  ) {
    recipients.push({
      id: shipment.driverUserId,
      name: shipment.driverName ?? 'Driver',
      email: shipment.driverEmail,
    })
  }
  for (const recipient of recipients) {
    const rendered = renderNotice({
      subject: 'Delivery request cancelled',
      greeting: recipient.name.split(/\s+/)[0] || 'there',
      lines,
      actionLabel: event.actorRole === 'CUSTOMER' ? 'Open dispatch board' : 'View shipment',
      actionUrl:
        event.actorRole === 'CUSTOMER'
          ? `${env.WEB_ORIGIN}/app/dispatch`
          : `${env.WEB_ORIGIN}/track/${encodeURIComponent(shipment.trackingCode)}`,
    })
    await queueRecipientEmail({
      userId: recipient.id,
      recipient: recipient.email,
      shipmentId: event.shipmentId,
      eventId: event.eventId,
      template: 'shipment_cancelled',
      ...rendered,
      payload: { trackingCode: shipment.trackingCode, previousStatus: event.previousStatus },
    })
  }
}

function watchEvent<T>(
  eventName: string,
  event: T,
  operation: (payload: T) => Promise<void>,
  identifiers: { shipmentId: string; eventId: string },
) {
  void operation(event).catch((error: unknown) => {
    logger.error(
      { err: error, shipmentId: identifiers.shipmentId, shipmentEventId: identifiers.eventId },
      `${eventName} email notifications could not be queued`,
    )
  })
}

export function startNotificationEventHandlers(): () => void {
  const unsubscribers = [
    domainEventBus.subscribe('shipment.statusChanged', (event) =>
      watchEvent('shipment.statusChanged', event, notifyCustomerStatus, event),
    ),
    domainEventBus.subscribe('shipment.requested', (event) =>
      watchEvent('shipment.requested', event, notifyNewRequest, event),
    ),
    domainEventBus.subscribe('shipment.assigned', (event) =>
      watchEvent('shipment.assigned', event, notifyAssignedDriver, event),
    ),
    domainEventBus.subscribe('shipment.cancelled', (event) =>
      watchEvent('shipment.cancelled', event, notifyCancellation, event),
    ),
  ]
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}
