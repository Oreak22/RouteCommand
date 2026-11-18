import type { AlertSeverity, AlertStatus, AlertType, ListAlertsQuery } from '@routecommand/shared'
import type { QueryResultRow } from 'pg'

import type { DatabaseExecutor } from '../../db/pool.js'
import { query } from '../../db/pool.js'

export interface AlertRecord {
  id: string
  type: AlertType
  severity: AlertSeverity
  status: AlertStatus
  driverId: string | null
  driverName: string | null
  zoneId: string | null
  zoneName: string | null
  shipmentId: string | null
  trackingCode: string | null
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface AlertRow extends QueryResultRow {
  id: string
  type: AlertType
  severity: AlertSeverity
  status: AlertStatus
  driver_id: string | null
  driver_name: string | null
  zone_id: string | null
  zone_name: string | null
  shipment_id: string | null
  tracking_code: string | null
  payload: Record<string, unknown>
  created_at: Date
  updated_at: Date
  resolved_at: Date | null
}

export function mapAlert(row: AlertRow): AlertRecord {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    driverId: row.driver_id,
    driverName: row.driver_name,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    shipmentId: row.shipment_id,
    trackingCode: row.tracking_code,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  }
}

const selectAlerts = `
  SELECT a.id, a.type, a.severity, a.status, a.driver_id,
         du.name AS driver_name, a.zone_id, z.name AS zone_name,
         a.shipment_id, s.tracking_code, a.payload, a.created_at, a.updated_at, a.resolved_at
  FROM alerts a
  LEFT JOIN drivers d ON d.id = a.driver_id
  LEFT JOIN users du ON du.id = d.user_id
  LEFT JOIN zones z ON z.id = a.zone_id
  LEFT JOIN shipments s ON s.id = a.shipment_id`

function whereAlerts(input: ListAlertsQuery): { where: string; values: unknown[] } {
  const values: unknown[] = []
  const clauses: string[] = []
  const add = (condition: string, value: unknown) => {
    values.push(value)
    clauses.push(condition.replace('?', `$${values.length}`))
  }
  if (input.status) add('a.status = ?::alert_status', input.status)
  if (input.severity) add('a.severity = ?::alert_severity', input.severity)
  if (input.type) add('a.type = ?::alert_type', input.type)
  if (input.driverId) add('a.driver_id = ?', input.driverId)
  if (input.zoneId) add('a.zone_id = ?', input.zoneId)
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

export async function listAlerts(input: ListAlertsQuery): Promise<AlertRecord[]> {
  const filters = whereAlerts(input)
  const result = await query<AlertRow>(
    `${selectAlerts} ${filters.where}
     ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
              a.created_at DESC, a.id
     LIMIT $${filters.values.length + 1} OFFSET $${filters.values.length + 2}`,
    [...filters.values, input.limit, input.offset],
  )
  return result.rows.map(mapAlert)
}

export async function countAlerts(input: Omit<ListAlertsQuery, 'limit' | 'offset'> = {}) {
  const filters = whereAlerts({ ...input, limit: 25, offset: 0 })
  const result = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM alerts a ${filters.where}`,
    filters.values,
  )
  return result.rows[0]?.total ?? 0
}

export async function getAlertForUpdate(alertId: string, executor: DatabaseExecutor) {
  const result = await executor.query<AlertRow>(`${selectAlerts} WHERE a.id = $1 FOR UPDATE OF a`, [
    alertId,
  ])
  return result.rows[0] ? mapAlert(result.rows[0]) : null
}

export async function updateAlertStatus(
  alertId: string,
  status: 'ACKNOWLEDGED' | 'RESOLVED',
  actorId: string,
  note: string | undefined,
  executor: DatabaseExecutor,
): Promise<AlertRecord | null> {
  const result = await executor.query<AlertRow>(
    `UPDATE alerts a SET status = $2::alert_status,
       acknowledged_by = CASE WHEN $2 = 'ACKNOWLEDGED' THEN $3 ELSE a.acknowledged_by END,
       resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE NULL END,
       payload = CASE WHEN $4::text IS NULL THEN a.payload
                      ELSE a.payload || jsonb_build_object('operatorNote', $4::text) END
     WHERE a.id = $1
     RETURNING a.id, a.type, a.severity, a.status, a.driver_id, NULL::text AS driver_name,
       a.zone_id, NULL::text AS zone_name, a.shipment_id, NULL::text AS tracking_code,
       a.payload, a.created_at, a.updated_at, a.resolved_at`,
    [alertId, status, actorId, note ?? null],
  )
  return result.rows[0] ? mapAlert(result.rows[0]) : null
}

export async function alertStats() {
  const result = await query<{
    status: AlertStatus
    severity: AlertSeverity
    count: number
  }>(`SELECT status, severity, count(*)::int AS count FROM alerts GROUP BY status, severity`)
  const stats = {
    total: 0,
    byStatus: { OPEN: 0, ACKNOWLEDGED: 0, RESOLVED: 0 } as Record<AlertStatus, number>,
    bySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } as Record<AlertSeverity, number>,
  }
  for (const row of result.rows) {
    stats.total += row.count
    stats.byStatus[row.status] += row.count
    stats.bySeverity[row.severity] += row.count
  }
  return stats
}
