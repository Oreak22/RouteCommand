import { ArrowRight, LocateFixed, PackageCheck, Plus, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageHeader } from '../components/common/PageHeader'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Skeleton } from '../components/ui/Skeleton'
import { StatusPill } from '../components/ui/StatusPill'
import { useAuth } from '../features/auth/auth-context'
import { useShipments } from '../features/shipments/api/hooks'

const completeStatuses = new Set(['DELIVERED', 'CANCELLED', 'RETURNED'])

function formatDate(value: string | null) {
  if (!value) return 'Waiting for an estimate'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

export function CustomerDashboardPage() {
  const { user } = useAuth()
  const shipmentsQuery = useShipments({ limit: 100, offset: 0 })
  const shipments = shipmentsQuery.data ?? []
  const activeCount = shipments.filter((shipment) => !completeStatuses.has(shipment.status)).length
  const deliveredCount = shipments.filter((shipment) => shipment.status === 'DELIVERED').length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer dashboard"
        title={`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        description="Request a delivery or follow your parcels from pickup to dropoff."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link className="btn btn-primary" to="/app/shipments">
              <Plus className="size-4" aria-hidden="true" />
              New shipment
            </Link>
            <Link className="btn btn-outline" to="/track">
              <LocateFixed className="size-4" aria-hidden="true" />
              Track a parcel
            </Link>
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2" aria-label="Shipment summary">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-base-content/55">
                In progress
              </p>
              <p className="mt-2 text-3xl font-semibold">
                {shipmentsQuery.isPending ? '—' : activeCount}
              </p>
            </div>
            <span className="rounded-box bg-primary/10 p-2.5 text-primary">
              <Truck className="size-5" aria-hidden="true" />
            </span>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-base-content/55">
                Delivered
              </p>
              <p className="mt-2 text-3xl font-semibold">
                {shipmentsQuery.isPending ? '—' : deliveredCount}
              </p>
            </div>
            <span className="rounded-box bg-success/10 p-2.5 text-success">
              <PackageCheck className="size-5" aria-hidden="true" />
            </span>
          </div>
        </Card>
      </section>

      <Card className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Your recent shipments</h2>
            <p className="mt-1 text-sm text-base-content/55">
              Open a tracking page for the latest delivery progress.
            </p>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/app/shipments">
            All shipments
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {shipmentsQuery.isError ? (
            <ErrorState
              title="Your shipments could not be loaded"
              description="Check your connection and try again."
              onRetry={() => void shipmentsQuery.refetch()}
            />
          ) : shipmentsQuery.isPending ? (
            <div className="space-y-3" role="status" aria-label="Loading shipments">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : shipments.length === 0 ? (
            <EmptyState
              title="No shipments yet"
              description="Create a delivery request to see its progress here."
            />
          ) : (
            shipments.slice(0, 5).map((shipment) => (
              <article
                className="flex min-w-0 flex-col gap-3 rounded-box border border-base-content/10 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
                key={shipment.id}
              >
                <div className="min-w-0">
                  <p className="font-data text-sm font-semibold">{shipment.trackingCode}</p>
                  <p className="mt-1 truncate text-sm text-base-content/65">
                    {shipment.dropoffAddress}
                  </p>
                  <p className="mt-1 text-xs text-base-content/50">
                    ETA · {formatDate(shipment.eta)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                  <StatusPill category="shipment" status={shipment.status} />
                  <Link
                    className="btn btn-ghost btn-sm"
                    to={`/track/${encodeURIComponent(shipment.trackingCode)}`}
                  >
                    Track
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
