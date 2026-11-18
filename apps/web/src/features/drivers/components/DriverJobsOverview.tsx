import { ArrowRight, PackageCheck } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { Link } from 'react-router-dom'

import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Skeleton } from '../../../components/ui/Skeleton'
import { StatusPill } from '../../../components/ui/StatusPill'
import { useSocketEvent } from '../../realtime/useRealtime'
import { shipmentKeys, useShipments } from '../../shipments/api/hooks'
import type { Shipment } from '../../shipments/api/client'

const completedStatuses = new Set<Shipment['status']>(['DELIVERED', 'CANCELLED', 'RETURNED'])

export function DriverJobsOverview() {
  const queryClient = useQueryClient()
  const jobsQuery = useShipments({ limit: 100, offset: 0 })
  const refreshJobs = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
  }, [queryClient])
  useSocketEvent('shipment:updated', refreshJobs)
  const jobs = (jobsQuery.data ?? [])
    .filter((shipment) => !completedStatuses.has(shipment.status))
    .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))
    .slice(0, 4)

  return (
    <Card aria-label="Assigned jobs">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PackageCheck className="size-4 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">Your jobs</h2>
          {!jobsQuery.isPending && !jobsQuery.isError && (
            <span className="badge badge-ghost">
              {jobsQuery.data?.filter((job) => !completedStatuses.has(job.status)).length ?? 0}
            </span>
          )}
        </div>
        <Link className="btn btn-ghost btn-sm" to="/driver/shipments">
          All jobs <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {jobsQuery.isError ? (
        <ErrorState
          title="Your jobs could not be loaded"
          description="Check your connection and try again."
          onRetry={() => void jobsQuery.refetch()}
        />
      ) : jobsQuery.isPending ? (
        <div className="space-y-3" role="status" aria-label="Loading assigned jobs">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState title="No active jobs" description="New assignments will appear here." />
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                className="flex min-w-0 flex-col gap-2 rounded-box border border-base-content/10 p-3 transition-colors hover:bg-base-200 sm:flex-row sm:items-center sm:justify-between"
                to="/driver/shipments"
                state={{ selectedShipmentId: job.id }}
              >
                <div className="min-w-0">
                  <p className="font-data text-sm font-semibold">{job.trackingCode}</p>
                  <p className="mt-1 truncate text-xs text-base-content/60">
                    {job.pickupAddress} → {job.dropoffAddress}
                  </p>
                </div>
                <StatusPill category="shipment" status={job.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
