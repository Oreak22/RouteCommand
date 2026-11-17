import { useMemo, useState } from 'react'

import { VehicleForm } from './VehicleForm'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { DataTable } from '../../../components/ui/DataTable'
import type { DataColumn } from '../../../components/ui/DataTable'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { useToast } from '../../../components/ui/toast-context'
import { fleetApi } from '../api/client'
import type { Vehicle } from '../api/client'
import { useFleetMutation, useVehicles } from '../api/hooks'

type VehicleTableRow = Vehicle & { actions: string }

function vehicleColumns(onEdit: (vehicle: Vehicle) => void): DataColumn<VehicleTableRow>[] {
  return [
    { key: 'plate', header: 'Plate', sortable: true, className: 'font-data font-semibold' },
    { key: 'type', header: 'Type', sortable: true },
    {
      key: 'capacityKg',
      header: 'Capacity',
      render: (vehicle) => `${vehicle.capacityKg.toLocaleString()} kg`,
    },
    {
      key: 'assignedDriverName',
      header: 'Assigned driver',
      render: (vehicle) =>
        vehicle.assignedDriverName ?? <span className="text-base-content/45">Unassigned</span>,
    },
    {
      key: 'isActive',
      header: 'State',
      render: (vehicle) => (
        <span className={`badge ${vehicle.isActive ? 'badge-success' : 'badge-ghost'}`}>
          {vehicle.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (vehicle) => <VehicleActions vehicle={vehicle} onEdit={() => onEdit(vehicle)} />,
    },
  ]
}

function VehicleActions({ vehicle, onEdit }: { vehicle: Vehicle; onEdit: () => void }) {
  const { pushToast } = useToast()
  const mutation = useFleetMutation(
    ({ id, active }: { id: string; active: boolean }) =>
      fleetApi.updateVehicle(id, { isActive: active }),
    [['vehicles'], ['drivers']],
  )
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate(
            { id: vehicle.id, active: !vehicle.isActive },
            { onError: (error) => pushToast(error.message, 'error') },
          )
        }
      >
        {vehicle.isActive ? 'Deactivate' : 'Reactivate'}
      </Button>
    </div>
  )
}

export function VehiclesPage() {
  const { data = [], isPending, isError, refetch } = useVehicles()
  const tableRows = data.map((vehicle) => ({ ...vehicle, actions: 'Manage' }))
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const columns = useMemo(
    () =>
      vehicleColumns((vehicle) => {
        setEditing(vehicle)
        setOpen(true)
      }),
    [],
  )

  return (
    <>
      <PageHeader
        eyebrow="Fleet operations"
        title="Vehicles"
        description="Register vehicles and review their current driver assignments."
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setOpen(true)
            }}
          >
            Add vehicle
          </Button>
        }
      />
      <Card>
        {isError ? (
          <ErrorState
            title="Vehicles could not be loaded"
            description="Check your connection and try again."
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <p className="py-10 text-center text-sm text-base-content/60" role="status">
            Loading vehicles…
          </p>
        ) : data.length === 0 ? (
          <EmptyState
            title="No vehicles registered"
            description="Add a vehicle to start building the fleet."
            action={
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null)
                  setOpen(true)
                }}
              >
                Add vehicle
              </Button>
            }
          />
        ) : (
          <DataTable
            rows={tableRows}
            columns={columns}
            getRowId={(vehicle) => vehicle.id}
            pageSize={10}
          />
        )}
      </Card>
      <VehicleForm
        key={editing?.id ?? 'new'}
        vehicle={editing}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
