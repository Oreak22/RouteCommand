import { ForbiddenError, NotFoundError } from '../../core/errors/app-error.js'
import { query } from '../../db/pool.js'

export async function assertDriverOwnsShipment(userId: string, shipmentId: string): Promise<void> {
  const result = await query<{ owned: boolean; exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM shipments WHERE id = $2) AS exists,
            EXISTS (
              SELECT 1 FROM shipments s
              JOIN drivers d ON d.id = s.driver_id
              WHERE s.id = $2 AND d.user_id = $1
            ) AS owned`,
    [userId, shipmentId],
  )
  const row = result.rows[0]
  if (!row?.exists) throw new NotFoundError('Shipment was not found.')
  if (!row.owned) throw new ForbiddenError('You do not have access to this shipment.')
}

export async function assertCustomerOwnsShipment(
  userId: string,
  shipmentId: string,
): Promise<void> {
  const result = await query<{ owned: boolean; exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM shipments WHERE id = $2) AS exists,
            EXISTS (SELECT 1 FROM shipments WHERE id = $2 AND customer_id = $1) AS owned`,
    [userId, shipmentId],
  )
  const row = result.rows[0]
  if (!row?.exists) throw new NotFoundError('Shipment was not found.')
  if (!row.owned) throw new ForbiddenError('You do not have access to this shipment.')
}
