import { shipmentStatuses } from '@routecommand/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, PackagePlus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ShipmentForm } from './ShipmentForm'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import type { DataColumn } from '../../../components/ui/DataTable'
import { DataTable } from '../../../components/ui/DataTable'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { FormField } from '../../../components/ui/FormField'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { StatusPill } from '../../../components/ui/StatusPill'
import { useToast } from '../../../components/ui/toast-context'
import { useAuth } from '../../auth/auth-context'
import { useDrivers } from '../../drivers/api/hooks'
import { useRealtime, useSocketEvent } from '../../realtime/useRealtime'
import type { Shipment } from '../api/client'
import type { ShipmentEvent } from '../api/client'
import { shipmentsApi } from '../api/client'
import {
  useShipmentCustomers,
  useCancelShipment,
  useCreateShipment,
  useShipment,
  useShipmentEvents,
  useShipments,
  useTransitionShipment,
  useUpdateShipment,
  shipmentKeys,
} from '../api/hooks'

function prettyStatus(status: string) {
  return status
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

function ShipmentTimeline({ events }: { events: ShipmentEvent[] }) {
  if (events.length === 0)
    return <p className="text-sm text-base-content/55">No timeline entries yet.</p>
  return (
    <ol className="space-y-3" aria-label="Shipment status timeline">
      {events.map((event) => (
        <li
          className="relative border-l border-base-content/15 pb-2 pl-4 last:border-transparent"
          key={event.id}
        >
          <span className="absolute -left-1.5 top-1 size-3 rounded-full bg-primary ring-2 ring-base-100" />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{prettyStatus(event.status)}</p>
            <time className="font-data text-xs text-base-content/50" dateTime={event.createdAt}>
              {formatDate(event.createdAt)}
            </time>
          </div>
          <p className="text-xs text-base-content/60">
            {event.actorName ?? 'System'}
            {event.note ? ` · ${event.note}` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}

export function ShipmentsWorkspace() {
  const { user } = useAuth()
  const role = user?.role ?? 'CUSTOMER'
  const canDispatch = role === 'ADMIN' || role === 'DISPATCHER'
  const canCreate = canDispatch || role === 'CUSTOMER'
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [transitionNote, setTransitionNote] = useState('')
  const [driverSelection, setDriverSelection] = useState<{
    shipmentId: string
    driverId: string
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { pushToast } = useToast()
  const queryClient = useQueryClient()
  const { subscribeShipment, unsubscribeShipment } = useRealtime()
  const filters = useMemo(
    () => ({ search, status: status || undefined, limit: 100 }),
    [search, status],
  )
  const shipmentsQuery = useShipments(filters)
  const shipmentQuery = useShipment(selectedId)
  const eventsQuery = useShipmentEvents(selectedId)
  const customersQuery = useShipmentCustomers('', canDispatch)
  const driversQuery = useDrivers({ limit: 100 }, canDispatch)
  const create = useCreateShipment()
  const update = useUpdateShipment()
  const transition = useTransitionShipment()
  const cancel = useCancelShipment()

  useEffect(() => {
    if (!selectedId) return
    subscribeShipment(selectedId)
    return () => unsubscribeShipment(selectedId)
  }, [selectedId, subscribeShipment, unsubscribeShipment])

  const onShipmentUpdated = useCallback(
    (event: { shipmentId: string }) => {
      void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
      if (event.shipmentId === selectedId) {
        void queryClient.invalidateQueries({ queryKey: shipmentKeys.detail(selectedId) })
        void queryClient.invalidateQueries({ queryKey: shipmentKeys.events(selectedId) })
      }
    },
    [queryClient, selectedId],
  )
  useSocketEvent('shipment:updated', onShipmentUpdated)

  const assignedDriverId =
    driverSelection && driverSelection.shipmentId === shipmentQuery.data?.id
      ? driverSelection.driverId
      : (shipmentQuery.data?.driverId ?? '')

  const rows = shipmentsQuery.data ?? []
  const columns: DataColumn<Shipment>[] = [
    {
      key: 'trackingCode',
      header: 'Tracking code',
      sortable: true,
      className: 'font-data text-xs',
      render: (shipment) => (
        <button
          className="font-data text-xs font-semibold text-primary hover:underline"
          onClick={() => setSelectedId(shipment.id)}
        >
          {shipment.trackingCode}
        </button>
      ),
    },
    { key: 'customerName', header: 'Customer', sortable: true },
    { key: 'dropoffAddress', header: 'Destination', sortable: true },
    {
      key: 'status',
      header: 'Status',
      render: (shipment) => <StatusPill category="shipment" status={shipment.status} />,
    },
    {
      key: 'eta',
      header: 'ETA',
      className: 'font-data text-xs',
      render: (shipment) => formatDate(shipment.eta),
    },
    {
      key: 'id',
      header: 'Details',
      render: (shipment) => (
        <Button size="sm" variant="ghost" onClick={() => setSelectedId(shipment.id)}>
          View <ArrowRight className="size-3.5" aria-hidden="true" />
        </Button>
      ),
    },
  ]

  async function createShipment(input: Parameters<typeof shipmentsApi.create>[0]) {
    const shipment = await create.mutateAsync(input)
    setSelectedId(shipment.id)
    pushToast(`Shipment ${shipment.trackingCode} created.`, 'success')
  }

  async function updateShipment(id: string, input: Parameters<typeof shipmentsApi.update>[1]) {
    await update.mutateAsync({ id, input })
    pushToast('Shipment updated.', 'success')
  }

  async function changeStatus(toStatus: Shipment['status']) {
    if (!shipmentQuery.data) return
    setActionError(null)
    try {
      await transition.mutateAsync({
        id: shipmentQuery.data.id,
        input: { toStatus, note: transitionNote.trim() || undefined },
        key: crypto.randomUUID(),
      })
      setTransitionNote('')
      pushToast(`Shipment marked ${prettyStatus(toStatus)}.`, 'success')
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not update the shipment status.',
      )
    }
  }

  async function cancelSelectedShipment() {
    if (!shipmentQuery.data) return
    setActionError(null)
    try {
      await cancel.mutateAsync({
        id: shipmentQuery.data.id,
        input: { reason: cancelReason.trim() },
      })
      setCancelOpen(false)
      setCancelReason('')
      pushToast('Shipment cancelled.', 'success')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not cancel the shipment.')
    }
  }

  async function saveDriverAssignment() {
    if (!shipmentQuery.data) return
    setActionError(null)
    try {
      await update.mutateAsync({
        id: shipmentQuery.data.id,
        input: { driverId: assignedDriverId || null },
      })
      pushToast('Driver assignment saved.', 'success')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not assign the driver.')
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Delivery operations
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {role === 'CUSTOMER'
              ? 'My shipments'
              : role === 'DRIVER'
                ? 'Assigned shipments'
                : 'Shipments'}
          </h1>
          <p className="mt-1 text-sm text-base-content/60">
            Create delivery requests and follow every shipment status change.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => {
              setEditingShipment(null)
              setFormOpen(true)
            }}
          >
            <PackagePlus className="size-4" aria-hidden="true" /> New shipment
          </Button>
        )}
      </header>

      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <FormField label="Search shipments">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tracking code, address, or customer"
            />
          </FormField>
          <FormField label="Filter by status">
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {shipmentStatuses.map((value) => (
                <option key={value} value={value}>
                  {prettyStatus(value)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        {shipmentsQuery.isError ? (
          <ErrorState
            title="Shipments could not be loaded"
            description="Check your connection and try again."
            onRetry={() => void shipmentsQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(shipment) => shipment.id}
            loading={shipmentsQuery.isPending}
            emptyTitle={search || status ? 'No shipments match these filters' : 'No shipments yet'}
          />
        )}
        <Button variant="ghost" size="sm" onClick={() => void shipmentsQuery.refetch()}>
          <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh list
        </Button>
      </Card>

      {formOpen && (
        <ShipmentForm
          key={editingShipment?.id ?? 'new-shipment'}
          open={formOpen}
          onClose={() => {
            setFormOpen(false)
            setEditingShipment(null)
          }}
          isCustomer={role === 'CUSTOMER'}
          customers={customersQuery.data ?? []}
          shipment={editingShipment}
          busy={create.isPending || update.isPending}
          error={customersQuery.isError ? 'Customer choices could not be loaded.' : null}
          onCreate={createShipment}
          onUpdate={updateShipment}
        />
      )}

      <Modal
        open={selectedId !== null}
        onClose={() => {
          setSelectedId(null)
          setActionError(null)
        }}
        title={shipmentQuery.data?.trackingCode ?? 'Shipment details'}
        description={
          shipmentQuery.data
            ? `${shipmentQuery.data.customerName} · ${prettyStatus(shipmentQuery.data.status)}`
            : 'Loading shipment details'
        }
      >
        {shipmentQuery.isPending ? (
          <p className="py-8 text-center text-sm text-base-content/60" role="status">
            Loading shipment…
          </p>
        ) : shipmentQuery.isError ? (
          <ErrorState
            title="Shipment could not be loaded"
            description="You may not have access to this shipment."
            onRetry={() => void shipmentQuery.refetch()}
          />
        ) : shipmentQuery.data ? (
          <div className="max-h-[72vh] space-y-5 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-field bg-base-200 p-3">
                <p className="text-xs text-base-content/55">Pickup</p>
                <p className="mt-1 text-sm font-medium">{shipmentQuery.data.pickupAddress}</p>
              </div>
              <div className="rounded-field bg-base-200 p-3">
                <p className="text-xs text-base-content/55">Dropoff</p>
                <p className="mt-1 text-sm font-medium">{shipmentQuery.data.dropoffAddress}</p>
              </div>
              <div className="rounded-field bg-base-200 p-3">
                <p className="text-xs text-base-content/55">Driver</p>
                <p className="mt-1 text-sm font-medium">
                  {shipmentQuery.data.driverName ?? 'Unassigned'}
                </p>
              </div>
              <div className="rounded-field bg-base-200 p-3">
                <p className="text-xs text-base-content/55">ETA</p>
                <p className="mt-1 text-sm font-medium">{formatDate(shipmentQuery.data.eta)}</p>
              </div>
            </div>
            {canDispatch && ['CREATED', 'ASSIGNED'].includes(shipmentQuery.data.status) && (
              <div className="space-y-3 rounded-box border border-base-content/10 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <FormField label="Assign available driver">
                    <Select
                      value={assignedDriverId}
                      onChange={(event) =>
                        setDriverSelection({
                          shipmentId: shipmentQuery.data!.id,
                          driverId: event.target.value,
                        })
                      }
                    >
                      {shipmentQuery.data.status !== 'ASSIGNED' && (
                        <option value="">Unassigned</option>
                      )}
                      {(driversQuery.data ?? [])
                        .filter(
                          (driver) =>
                            driver.isActive &&
                            (driver.status === 'AVAILABLE' ||
                              driver.id === shipmentQuery.data?.driverId),
                        )
                        .map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.name} · {driver.status}
                          </option>
                        ))}
                    </Select>
                  </FormField>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={update.isPending}
                    onClick={() => void saveDriverAssignment()}
                  >
                    Save assignment
                  </Button>
                </div>
                {canDispatch && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingShipment(shipmentQuery.data!)
                      setFormOpen(true)
                    }}
                  >
                    Edit details
                  </Button>
                )}
              </div>
            )}
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Status actions</h3>
                <p className="mt-1 text-xs text-base-content/55">
                  Only actions allowed for your role and this shipment state are shown.
                </p>
              </div>
              {shipmentQuery.data.allowedTransitions &&
                shipmentQuery.data.allowedTransitions.length > 0 && (
                  <FormField label="Timeline note">
                    <Input
                      value={transitionNote}
                      onChange={(event) => setTransitionNote(event.target.value)}
                      maxLength={2000}
                      placeholder="Optional status note"
                    />
                  </FormField>
                )}
              <div className="flex flex-wrap gap-2">
                {(shipmentQuery.data.allowedTransitions ?? []).map((nextStatus) => (
                  <span className="contents" key={nextStatus}>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={transition.isPending}
                      disabled={nextStatus === 'ASSIGNED' && !shipmentQuery.data?.driverId}
                      onClick={() => void changeStatus(nextStatus)}
                    >
                      Mark {prettyStatus(nextStatus)}
                    </Button>
                    {nextStatus === 'ASSIGNED' && !shipmentQuery.data?.driverId && (
                      <span className="self-center text-xs text-base-content/55">
                        Select and save an available driver first.
                      </span>
                    )}
                  </span>
                ))}
                {shipmentQuery.data.canCancel && (
                  <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>
                    Cancel shipment
                  </Button>
                )}
              </div>
              {actionError && (
                <p role="alert" className="text-sm text-error">
                  {actionError}
                </p>
              )}
            </section>
            <section className="space-y-3 border-t border-base-content/10 pt-4">
              <div>
                <h3 className="text-sm font-semibold">Shipment timeline</h3>
                <p className="mt-1 text-xs text-base-content/55">
                  Status changes are recorded in order.
                </p>
              </div>
              {eventsQuery.isError ? (
                <ErrorState
                  title="Timeline could not be loaded"
                  description="Retry to load shipment events."
                  onRetry={() => void eventsQuery.refetch()}
                />
              ) : eventsQuery.isPending ? (
                <p className="text-sm text-base-content/55" role="status">
                  Loading timeline…
                </p>
              ) : (
                <ShipmentTimeline events={eventsQuery.data ?? []} />
              )}
            </section>
          </div>
        ) : (
          <EmptyState
            title="Shipment not found"
            description="Close this panel and refresh the list."
          />
        )}
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel shipment"
        description="The cancellation reason will be added to the shipment timeline."
      >
        <div className="space-y-4">
          <FormField label="Reason" required>
            <Input
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              minLength={1}
              maxLength={1000}
            />
          </FormField>
          {actionError && (
            <p className="text-sm text-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="modal-action">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep shipment
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              disabled={!cancelReason.trim()}
              onClick={() => void cancelSelectedShipment()}
            >
              Confirm cancellation
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
