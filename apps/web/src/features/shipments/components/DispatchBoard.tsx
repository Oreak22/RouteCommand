import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { PageHeader } from '../../../components/common/PageHeader'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/toast-context'
import { useSocketEvent } from '../../realtime/useRealtime'
import {
  useAssignDispatch,
  useAssignDispatchBatch,
  useDispatchSuggestions,
} from '../api/dispatch-hooks'
import { shipmentKeys, useShipments } from '../api/hooks'

function ageLabel(createdAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

export function DispatchBoard() {
  const location = useLocation()
  const routeDriverId = (location.state as { selectedDriverId?: unknown } | null)?.selectedDriverId
  const initialDriverId = typeof routeDriverId === 'string' ? routeDriverId : null
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [batchSelection, setBatchSelection] = useState<Set<string>>(new Set())
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(initialDriverId)
  const { pushToast } = useToast()
  const queryClient = useQueryClient()
  const shipmentsQuery = useShipments({ status: 'CREATED', limit: 100 })
  const shipments = useMemo(
    () =>
      [...(shipmentsQuery.data ?? [])].sort((a, b) => {
        const priorityOrder = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }
        return (
          priorityOrder[a.priority] - priorityOrder[b.priority] ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
      }),
    [shipmentsQuery.data],
  )
  const batchShipments = shipments.filter((shipment) => batchSelection.has(shipment.id))
  const selected =
    shipments.find(
      (shipment) =>
        shipment.id === selectedId &&
        (batchShipments.length === 0 || batchSelection.has(shipment.id)),
    ) ??
    batchShipments[0] ??
    shipments[0]
  const suggestionsQuery = useDispatchSuggestions(selected?.id ?? null)
  const assign = useAssignDispatch()
  const assignBatch = useAssignDispatchBatch()
  const suggestions = suggestionsQuery.data ?? []
  const chosenDriver = selectedDriverId
    ? suggestions.some((item) => item.driverId === selectedDriverId)
      ? selectedDriverId
      : null
    : (suggestions[0]?.driverId ?? null)
  const batchWeightKg = batchShipments.reduce((total, shipment) => total + shipment.weightKg, 0)

  const onShipmentUpdated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['dispatch', 'suggestions'] })
  }, [queryClient])
  const onDriverStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['dispatch', 'suggestions'] })
  }, [queryClient])
  useSocketEvent('shipment:updated', onShipmentUpdated)
  useSocketEvent('driver:status', onDriverStatus)

  async function assignDriver() {
    if (!selected || !chosenDriver) return
    try {
      await assign.mutateAsync({ shipmentId: selected.id, driverId: chosenDriver })
      pushToast(`Driver assigned to ${selected.trackingCode}.`, 'success')
      setSelectedId(null)
      setSelectedDriverId(null)
    } catch (error) {
      pushToast(
        error instanceof Error
          ? error.message
          : 'Assignment failed. Refresh suggestions and retry.',
        'error',
      )
      void suggestionsQuery.refetch()
    }
  }

  async function assignBatchToDriver() {
    if (!chosenDriver || batchShipments.length < 2) return
    try {
      const result = await assignBatch.mutateAsync({
        shipmentIds: batchShipments.map((shipment) => shipment.id),
        driverId: chosenDriver,
      })
      pushToast(
        `Assigned ${result.stops.length} shipments in nearest-pickup order (${result.totalWeightKg} kg total).`,
        'success',
      )
      setBatchSelection(new Set())
      setSelectedId(null)
      setSelectedDriverId(null)
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : 'Batch assignment failed. Refresh and retry.',
        'error',
      )
      void suggestionsQuery.refetch()
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Dispatch board"
        description="Review unassigned requests and assign a qualified driver using fresh location and vehicle data."
      />
      {shipmentsQuery.isError ? (
        <ErrorState
          title="Dispatch queue could not be loaded"
          description="Check your connection and retry."
          onRetry={() => void shipmentsQuery.refetch()}
        />
      ) : shipmentsQuery.isPending ? (
        <div className="grid min-h-48 place-items-center">
          <Spinner label="Loading dispatch queue" />
        </div>
      ) : shipments.length === 0 ? (
        <EmptyState
          title="No shipments need dispatch"
          description="New customer requests will appear here."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.5fr)]">
          <Card className="p-0">
            <div className="border-b border-base-content/10 p-4">
              <h2 className="font-semibold">
                Unassigned queue <span className="text-base-content/50">({shipments.length})</span>
              </h2>
              <p className="mt-1 text-xs text-base-content/55">
                Priority first, then oldest request.
              </p>
            </div>
            <ul className="divide-y divide-base-content/10">
              {shipments.map((shipment) => (
                <li key={shipment.id}>
                  <div
                    className={`flex items-start gap-3 p-4 transition-colors ${selected?.id === shipment.id || batchSelection.has(shipment.id) ? 'bg-primary/8' : 'hover:bg-base-200'}`}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary mt-1"
                      aria-label={`Select ${shipment.trackingCode} for batch assignment`}
                      checked={batchSelection.has(shipment.id)}
                      onChange={(event) => {
                        setBatchSelection((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(shipment.id)
                          else next.delete(shipment.id)
                          return next
                        })
                        setSelectedId(shipment.id)
                        setSelectedDriverId(null)
                      }}
                    />
                    <button
                      className="min-w-0 flex-1 text-left"
                      aria-pressed={selected?.id === shipment.id}
                      onClick={() => {
                        setSelectedId(shipment.id)
                        setSelectedDriverId(null)
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold">
                          {shipment.trackingCode}
                        </span>
                        <Badge
                          tone={
                            shipment.priority === 'URGENT'
                              ? 'error'
                              : shipment.priority === 'HIGH'
                                ? 'warning'
                                : 'default'
                          }
                        >
                          {shipment.priority}
                        </Badge>
                      </div>
                      <p className="mt-2 truncate text-sm">{shipment.pickupAddress}</p>
                      <p className="mt-1 text-xs text-base-content/55">
                        {shipment.customerName} · waiting {ageLabel(shipment.createdAt)}
                      </p>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            {selected && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-base-content/10 pb-4">
                  <div>
                    <h2 className="font-semibold">Driver suggestions</h2>
                    <p className="mt-1 text-sm text-base-content/55">
                      {selected.trackingCode} · {selected.weightKg} kg · pickup within the
                      configured radius
                    </p>
                    {batchShipments.length > 1 && (
                      <p className="mt-1 text-xs text-base-content/55">
                        {batchShipments.length} selected · {batchWeightKg} kg combined · pickups
                        ordered by nearest next stop
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void suggestionsQuery.refetch()}
                    loading={suggestionsQuery.isFetching}
                  >
                    Refresh
                  </Button>
                </div>
                {suggestionsQuery.isError ? (
                  <ErrorState
                    title="Suggestions could not be loaded"
                    description="Refresh to get current availability and location data."
                    onRetry={() => void suggestionsQuery.refetch()}
                  />
                ) : suggestionsQuery.isPending ? (
                  <div className="grid min-h-40 place-items-center">
                    <Spinner label="Ranking eligible drivers" />
                  </div>
                ) : suggestions.length === 0 ? (
                  <EmptyState
                    title="No eligible drivers nearby"
                    description="Drivers need an active capable vehicle, a fresh accurate location, and no unresolved signal-loss alert."
                  />
                ) : (
                  <>
                    {selectedDriverId &&
                      !suggestions.some((item) => item.driverId === selectedDriverId) && (
                        <p
                          className="mt-4 rounded-field bg-warning/10 p-3 text-sm text-warning-content"
                          role="status"
                        >
                          The driver selected on the map is not eligible for this shipment. Choose
                          an eligible driver below.
                        </p>
                      )}
                    {batchShipments.length > 1 &&
                      !suggestions.some((driver) => driver.capacityKg >= batchWeightKg) && (
                        <p
                          className="mt-4 rounded-field bg-warning/10 p-3 text-sm text-warning-content"
                          role="status"
                        >
                          No suggested vehicle can carry the combined {batchWeightKg} kg load.
                          Reduce the batch size or choose another driver.
                        </p>
                      )}
                    <ul className="mt-4 divide-y divide-base-content/10">
                      {suggestions.map((driver, index) => (
                        <li key={driver.driverId}>
                          <div
                            className={`flex cursor-pointer items-start gap-3 rounded-field p-3 ${chosenDriver === driver.driverId ? 'bg-primary/8' : 'hover:bg-base-200'}`}
                          >
                            <input
                              id={`dispatch-driver-${driver.driverId}`}
                              className="radio radio-primary mt-1"
                              type="radio"
                              name="dispatch-driver"
                              checked={chosenDriver === driver.driverId}
                              onChange={() => setSelectedDriverId(driver.driverId)}
                            />
                            <label
                              className="min-w-0 flex-1 cursor-pointer"
                              htmlFor={`dispatch-driver-${driver.driverId}`}
                            >
                              <span className="sr-only">Select driver: </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2 font-medium">
                                  {index === 0 && <Badge tone="success">Best match</Badge>}
                                  {driver.name}
                                  {driver.zoneMatch && <Badge tone="info">In zone</Badge>}
                                </span>
                                <span className="mt-1 block text-sm text-base-content/65">
                                  {driver.vehicleType} · {driver.capacityKg} kg capacity ·{' '}
                                  {(driver.distanceM / 1000).toFixed(1)} km · about{' '}
                                  {Math.max(1, Math.round(driver.etaSeconds / 60))} min
                                </span>
                                <span className="mt-1 block text-xs text-base-content/50">
                                  Last signal {new Date(driver.lastSeenAt).toLocaleTimeString()} ·{' '}
                                  {driver.workload} active jobs
                                </span>
                              </span>
                            </label>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-5 flex justify-end">
                      {batchShipments.length > 1 ? (
                        <Button
                          loading={assignBatch.isPending}
                          disabled={
                            !chosenDriver ||
                            !suggestions.some(
                              (driver) =>
                                driver.driverId === chosenDriver &&
                                driver.capacityKg >= batchWeightKg,
                            )
                          }
                          onClick={() => void assignBatchToDriver()}
                        >
                          Assign {batchShipments.length} stops to selected driver
                        </Button>
                      ) : (
                        <Button
                          loading={assign.isPending}
                          disabled={!chosenDriver}
                          onClick={() => void assignDriver()}
                        >
                          Assign selected driver
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
