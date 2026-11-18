import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { DriverForm } from './DriverForm'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import type { DataColumn } from '../../../components/ui/DataTable'
import { DataTable } from '../../../components/ui/DataTable'
import { Drawer } from '../../../components/ui/Drawer'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { FormField } from '../../../components/ui/FormField'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { StatusPill } from '../../../components/ui/StatusPill'
import { useToast } from '../../../components/ui/toast-context'
import { useAuth } from '../../auth/auth-context'
import { fleetApi } from '../api/client'
import type { Driver } from '../api/client'
import { fleetKeys, useDrivers, useVehicleDriverAssignment, useVehicles } from '../api/hooks'

function relativeTime(value: string | null) {
  if (!value) return 'No signal'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

export function DriversPage() {
  const location = useLocation()
  const routeState = location.state as {
    selectedDriverId?: unknown
    selectedDriverName?: unknown
  } | null
  const mapSelectedDriverId =
    typeof routeState?.selectedDriverId === 'string' ? routeState.selectedDriverId : null
  const mapSelectedDriverName =
    typeof routeState?.selectedDriverName === 'string' ? routeState.selectedDriverName : ''
  const [search, setSearch] = useState(mapSelectedDriverName)
  const [status, setStatus] = useState('')
  const [highlightedDriverId] = useState<string | null>(mapSelectedDriverId)
  const [selected, setSelected] = useState<Driver | null>(null)
  const [mapSelectionDismissed, setMapSelectionDismissed] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const { user } = useAuth()
  const {
    data = [],
    isPending,
    isError,
    refetch,
  } = useDrivers({ search, status: status || undefined })
  const mapSelectedDriver = data.find((driver) => driver.id === mapSelectedDriverId) ?? null
  const selectedDriver = selected ?? (mapSelectionDismissed ? null : mapSelectedDriver)
  const tableRows = useMemo(() => data.map((driver) => ({ ...driver, actions: 'Manage' })), [data])
  const columns = useMemo<DataColumn<(typeof tableRows)[number]>[]>(
    () => [
      {
        key: 'name',
        header: 'Driver',
        sortable: true,
        render: (driver) => (
          <div>
            <p className="font-medium">{driver.name}</p>
            <p className="text-xs text-base-content/55">{driver.email}</p>
          </div>
        ),
      },
      { key: 'licenseNo', header: 'License', className: 'font-data text-xs' },
      {
        key: 'status',
        header: 'Availability',
        render: (driver) => <StatusPill category="driver" status={driver.status} />,
      },
      {
        key: 'vehiclePlate',
        header: 'Vehicle',
        render: (driver) =>
          driver.vehiclePlate ?? <span className="text-base-content/45">Unassigned</span>,
      },
      {
        key: 'lastSeenAt',
        header: 'Signal',
        render: (driver) => (
          <span className={driver.signalState === 'LIVE' ? 'text-success' : 'text-warning'}>
            {driver.signalState === 'NO_SIGNAL'
              ? 'No signal'
              : driver.signalState === 'SIGNAL_LOST'
                ? 'Signal lost'
                : relativeTime(driver.lastSeenAt)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        render: (driver) => (
          <Button size="sm" variant="ghost" onClick={() => setSelected(driver)}>
            Manage
          </Button>
        ),
      },
    ],
    [],
  )

  return (
    <>
      <PageHeader
        eyebrow="Fleet operations"
        title="Drivers"
        description="Review driver availability, signal health, and assigned vehicles."
        actions={
          user?.role === 'ADMIN' ? (
            <Button onClick={() => setCreateOpen(true)}>Add driver</Button>
          ) : undefined
        }
      />
      <Card>
        <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_12rem]">
          <FormField label="Search drivers">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email, license, plate"
            />
          </FormField>
          <FormField label="Availability">
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="AVAILABLE">Available</option>
              <option value="BUSY">Busy</option>
              <option value="ON_BREAK">On break</option>
              <option value="OFFLINE">Offline</option>
            </Select>
          </FormField>
        </div>
        {isError ? (
          <ErrorState
            title="Drivers could not be loaded"
            description="Check your connection and try again."
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <p className="py-10 text-center text-sm text-base-content/60" role="status">
            Loading drivers…
          </p>
        ) : data.length === 0 ? (
          <EmptyState
            title="No drivers found"
            description="Try changing the filters or add a driver account to start building your fleet."
            action={
              user?.role === 'ADMIN' ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Add driver
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            rows={tableRows}
            columns={columns}
            getRowId={(driver) => driver.id}
            pageSize={10}
            highlightedRowId={highlightedDriverId}
          />
        )}
      </Card>
      <DriverDetailDrawer
        key={selectedDriver?.id ?? 'closed'}
        driver={selectedDriver}
        onClose={() => {
          setSelected(null)
          setMapSelectionDismissed(true)
        }}
        onUpdated={(driver) => setSelected(driver)}
      />
      <DriverForm open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}

function DriverDetailDrawer({
  driver,
  onClose,
  onUpdated,
}: {
  driver: Driver | null
  onClose: () => void
  onUpdated: (driver: Driver) => void
}) {
  const { data: vehicles = [] } = useVehicles()
  const assignment = useVehicleDriverAssignment()
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const [licenseNo, setLicenseNo] = useState(driver?.licenseNo ?? '')
  const [vehicleId, setVehicleId] = useState(driver?.vehicleId ?? '')
  const [busy, setBusy] = useState(false)
  if (!driver) return null
  const currentDriver = driver

  async function save() {
    setBusy(true)
    try {
      await fleetApi.updateDriver(currentDriver.id, { licenseNo: licenseNo.trim() })
      const assigned = await assignment.mutateAsync({
        driverId: currentDriver.id,
        vehicleId: vehicleId || null,
      })
      onUpdated(assigned)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fleetKeys.drivers }),
        queryClient.invalidateQueries({ queryKey: fleetKeys.vehicles }),
      ])
      pushToast('Driver profile updated.', 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not update driver.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open title="Driver details" side="right" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold">{driver.name}</h3>
          <p className="text-sm text-base-content/60">{driver.email}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill category="driver" status={driver.status} />
            <span className="badge badge-ghost">
              {driver.signalState === 'NO_SIGNAL'
                ? 'No signal'
                : driver.signalState === 'SIGNAL_LOST'
                  ? 'Signal lost'
                  : `Seen ${relativeTime(driver.lastSeenAt)}`}
            </span>
          </div>
        </div>
        <FormField label="License number">
          <Input
            value={licenseNo}
            onChange={(event) => setLicenseNo(event.target.value)}
            maxLength={80}
            required
          />
        </FormField>
        <FormField label="Assigned vehicle">
          <Select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            <option value="">No vehicle</option>
            {vehicles
              .filter(
                (vehicle) =>
                  vehicle.isActive &&
                  (!vehicle.assignedDriverId || vehicle.assignedDriverId === currentDriver.id),
              )
              .map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plate} · {vehicle.type}
                </option>
              ))}
          </Select>
        </FormField>
        <Button loading={busy} onClick={() => void save()}>
          Save driver
        </Button>
      </div>
    </Drawer>
  )
}
