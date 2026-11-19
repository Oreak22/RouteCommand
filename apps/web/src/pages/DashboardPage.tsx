import { useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowUpRight, MapPinned, PackageCheck, Truck, Users } from 'lucide-react'
import { useCallback } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader } from '../components/common/PageHeader'
import { Card } from '../components/ui/Card'
import { DataTable } from '../components/ui/DataTable'
import type { DataColumn } from '../components/ui/DataTable'
import { ErrorState } from '../components/ui/ErrorState'
import { StatCard } from '../components/ui/StatCard'
import { StatusPill } from '../components/ui/StatusPill'
import { alertKeys, useAlertStats } from '../features/alerts/api/hooks'
import { useAuth } from '../features/auth/auth-context'
import type { Driver } from '../features/drivers/api/client'
import { fleetKeys, useAllDrivers } from '../features/drivers/api/hooks'
import { useSocketEvent } from '../features/realtime/useRealtime'
import type { Shipment } from '../features/shipments/api/client'
import { shipmentKeys, useShipments } from '../features/shipments/api/hooks'
import { zoneKeys, useZones } from '../features/zones/api/hooks'

type ShipmentRow = {
  id: string
  trackingCode: string
  recipient: string
  destination: string
  status: Shipment['status']
  eta: string
}

const columns: DataColumn<ShipmentRow>[] = [
  {
    key: 'trackingCode',
    header: 'Tracking ID',
    sortable: true,
    className: 'font-data text-xs',
    render: (row) => (
      <Link className="link link-primary font-data text-xs" to={`/track/${row.trackingCode}`}>
        {row.trackingCode}
      </Link>
    ),
  },
  { key: 'recipient', header: 'Customer', sortable: true },
  { key: 'destination', header: 'Destination', sortable: true },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusPill category="shipment" status={row.status} />,
  },
  { key: 'eta', header: 'ETA', className: 'font-data text-xs' },
]

const terminalStatuses = new Set<Shipment['status']>(['DELIVERED', 'CANCELLED', 'RETURNED'])

function formatEta(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  )
}

function driverCounts(drivers: Driver[]) {
  return {
    available: drivers.filter((driver) => driver.status === 'AVAILABLE').length,
    busy: drivers.filter((driver) => driver.status === 'BUSY').length,
    onBreak: drivers.filter((driver) => driver.status === 'ON_BREAK').length,
    offline: drivers.filter((driver) => driver.status === 'OFFLINE').length,
  }
}

export function DashboardPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const shipmentsQuery = useShipments({ limit: 100, offset: 0 })
  const driversQuery = useAllDrivers()
  const zonesQuery = useZones({ active: true })
  const alertsQuery = useAlertStats()

  const shipments = shipmentsQuery.data ?? []
  const drivers = driversQuery.data ?? []
  const counts = driverCounts(drivers)
  const activeShipments = shipments.filter((shipment) => !terminalStatuses.has(shipment.status))
  const recentRows: ShipmentRow[] = [...shipments]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 10)
    .map((shipment) => ({
      id: shipment.id,
      trackingCode: shipment.trackingCode,
      recipient: shipment.customerName,
      destination: shipment.dropoffAddress,
      status: shipment.status,
      eta: formatEta(shipment.eta),
    }))
  const isDashboardLoading =
    shipmentsQuery.isPending ||
    driversQuery.isPending ||
    zonesQuery.isPending ||
    alertsQuery.isPending
  const hasAuxiliaryError = zonesQuery.isError || alertsQuery.isError

  const onShipmentUpdated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
  }, [queryClient])
  const onDriverStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: fleetKeys.drivers })
  }, [queryClient])
  const onAlertUpdated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: alertKeys.all })
  }, [queryClient])
  const onZoneUpdated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: zoneKeys.all })
  }, [queryClient])
  useSocketEvent('shipment:updated', onShipmentUpdated)
  useSocketEvent('driver:status', onDriverStatus)
  useSocketEvent('alert:created', onAlertUpdated)
  useSocketEvent('alert:updated', onAlertUpdated)
  useSocketEvent('zone:updated', onZoneUpdated)

  const driverSummary = driversQuery.isPending
    ? 'Loading current driver status'
    : driversQuery.isError
      ? 'Fleet status unavailable'
      : `${counts.available} available · ${counts.busy} on delivery`

  return (
    <>
      <PageHeader
        eyebrow="Operations overview"
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user?.name?.split(' ')[0] ?? 'there'}`}
        description="Current fleet, delivery, alert, and zone activity from your RouteCommand workspace."
        actions={
          <Link className="btn btn-primary" to="/app/dispatch">
            Open dispatch board <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />

      <section
        className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4"
        aria-label="Operations summary"
        aria-busy={isDashboardLoading}
      >
        <StatCard
          label="Active · latest 100 shipments"
          value={
            shipmentsQuery.isError ? '—' : shipmentsQuery.isPending ? '…' : activeShipments.length
          }
          change="Created, assigned, or in progress"
          icon={<PackageCheck className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Drivers on duty"
          value={
            driversQuery.isError
              ? '—'
              : driversQuery.isPending
                ? '…'
                : counts.available + counts.busy
          }
          change={driverSummary}
          icon={<Truck className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Open alerts"
          value={
            alertsQuery.isError
              ? '—'
              : alertsQuery.isPending
                ? '…'
                : (alertsQuery.data?.byStatus.OPEN ?? 0)
          }
          change="Needs dispatcher review"
          icon={<Activity className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Active zones"
          value={
            zonesQuery.isError ? '—' : zonesQuery.isPending ? '…' : (zonesQuery.data?.length ?? 0)
          }
          change="Enabled service and delivery zones"
          icon={<MapPinned className="size-5" aria-hidden="true" />}
        />
      </section>

      {hasAuxiliaryError && (
        <div className="mt-4">
          <ErrorState
            title="Some operations data could not be loaded"
            description="Retry to refresh the overview from the server."
            onRetry={() =>
              void Promise.all([
                shipmentsQuery.refetch(),
                driversQuery.refetch(),
                zonesQuery.refetch(),
                alertsQuery.refetch(),
              ])
            }
          />
        </div>
      )}

      <section className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Recent shipments</h2>
              <p className="mt-1 text-xs text-base-content/55">
                Latest requests returned by the shipment service
              </p>
            </div>
            <Link className="btn btn-ghost btn-sm" to="/app/shipments">
              All shipments
            </Link>
          </div>
          {shipmentsQuery.isError ? (
            <div className="mt-5">
              <ErrorState
                title="Shipments could not be loaded"
                description="Check your connection and try again."
                onRetry={() => void shipmentsQuery.refetch()}
              />
            </div>
          ) : (
            <div className="mt-5">
              <DataTable
                rows={recentRows}
                columns={columns}
                getRowId={(row) => row.id}
                loading={shipmentsQuery.isPending}
                emptyTitle="No shipments found"
                pageSize={5}
              />
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Fleet pulse</h2>
              <p className="mt-1 text-xs text-base-content/55">Current driver status</p>
            </div>
            <Users className="size-4 text-primary" aria-hidden="true" />
          </div>
          {driversQuery.isError ? (
            <div className="mt-5">
              <ErrorState
                title="Fleet could not be loaded"
                description="Check your connection and retry."
                onRetry={() => void driversQuery.refetch()}
              />
            </div>
          ) : (
            <div className="mt-5 space-y-4" aria-busy={driversQuery.isPending}>
              {(
                [
                  ['Available', counts.available, 'bg-driver-available'],
                  ['On delivery', counts.busy, 'bg-driver-busy'],
                  ['On break', counts.onBreak, 'bg-driver-break'],
                  ['Offline', counts.offline, 'bg-driver-offline'],
                ] as const
              ).map(([label, count, color]) => {
                const percentage = drivers.length ? (count / drivers.length) * 100 : 0
                return (
                  <div className="space-y-1.5" key={label}>
                    <div className="flex justify-between text-xs">
                      <span className="text-base-content/65">{label}</span>
                      <span className="font-data">{driversQuery.isPending ? '…' : count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-base-300">
                      <div
                        className={`h-full rounded-full ${color}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <Link
            className="mt-6 inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline"
            to="/map"
          >
            Open live map <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Card>
      </section>
    </>
  )
}
