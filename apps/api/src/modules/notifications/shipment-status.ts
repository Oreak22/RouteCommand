import { query } from '../../db/pool.js'

export interface ShipmentStatusEmailData {
  customerId: string
  customerName: string
  customerEmail: string
  customerActive: boolean
  customerVerified: boolean
  trackingCode: string
  pickupAddress: string
  dropoffAddress: string
  weightKg: number
  priority: string
  scheduledAt: Date | null
  eta: Date | null
  driverUserId: string | null
  driverName: string | null
  driverEmail: string | null
  driverActive: boolean
  driverVerified: boolean
  vehicleType: string | null
}

export async function getShipmentStatusEmailData(
  shipmentId: string,
): Promise<ShipmentStatusEmailData | null> {
  const result = await query<ShipmentStatusEmailData>(
    `SELECT customer.id AS "customerId", customer.name AS "customerName",
            customer.email::text AS "customerEmail", customer.is_active AS "customerActive",
            (customer.email_verified_at IS NOT NULL) AS "customerVerified",
            s.tracking_code AS "trackingCode", s.pickup_address AS "pickupAddress",
            s.dropoff_address AS "dropoffAddress", s.weight_kg::float8 AS "weightKg",
            s.priority::text AS priority, s.scheduled_at AS "scheduledAt", s.eta,
            driver.user_id AS "driverUserId", driver_user.name AS "driverName",
            driver_user.email::text AS "driverEmail", COALESCE(driver_user.is_active, false) AS "driverActive",
            (driver_user.email_verified_at IS NOT NULL) AS "driverVerified",
            vehicle.type::text AS "vehicleType"
     FROM shipments s
     JOIN users customer ON customer.id = s.customer_id
     LEFT JOIN drivers driver ON driver.id = s.driver_id
     LEFT JOIN users driver_user ON driver_user.id = driver.user_id AND driver_user.is_active
     LEFT JOIN vehicles vehicle ON vehicle.id = driver.vehicle_id
     WHERE s.id = $1`,
    [shipmentId],
  )
  return result.rows[0] ?? null
}
