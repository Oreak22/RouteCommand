import type { AlertStatus } from '@routecommand/shared'
import { useState } from 'react'

import { PageHeader } from '../../../components/common/PageHeader'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Spinner } from '../../../components/ui/Spinner'
import { StatusPill } from '../../../components/ui/StatusPill'
import { useAcknowledgeAlert, useAlerts, useResolveAlert } from '../api/hooks'

const filters: { label: string; value: AlertStatus | undefined }[] = [
  { label: 'Open', value: 'OPEN' },
  { label: 'Acknowledged', value: 'ACKNOWLEDGED' },
  { label: 'Resolved', value: 'RESOLVED' },
  { label: 'All', value: undefined },
]

function readable(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function AlertsPage() {
  const [status, setStatus] = useState<AlertStatus | undefined>('OPEN')
  const query = useAlerts(status ? { status } : {})
  const acknowledge = useAcknowledgeAlert()
  const resolve = useResolveAlert()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Alerts"
        description="Review geofence and telemetry signals, then acknowledge or resolve them."
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter alerts by status">
        {filters.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={status === filter.value ? 'primary' : 'secondary'}
            aria-pressed={status === filter.value}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="grid min-h-40 place-items-center">
          <Spinner label="Loading alerts" />
        </div>
      ) : query.isError ? (
        <ErrorState
          title="Alerts could not be loaded"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : query.data?.data.length ? (
        <div className="overflow-hidden rounded-box border border-base-content/10 bg-base-100">
          <ul className="divide-y divide-base-content/10">
            {query.data.data.map((alert) => (
              <li
                className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                key={alert.id}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{readable(alert.type)}</span>
                    <StatusPill category="alert" status={alert.severity} />
                    <Badge
                      tone={
                        alert.status === 'OPEN'
                          ? 'warning'
                          : alert.status === 'ACKNOWLEDGED'
                            ? 'info'
                            : 'success'
                      }
                    >
                      {readable(alert.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-base-content/65">
                    {[alert.driverName, alert.zoneName, alert.trackingCode]
                      .filter(Boolean)
                      .join(' · ') || 'Operational signal'}
                  </p>
                  <time
                    className="font-data text-xs text-base-content/50"
                    dateTime={alert.createdAt}
                  >
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(alert.createdAt))}
                  </time>
                </div>
                {alert.status !== 'RESOLVED' && (
                  <div className="flex shrink-0 gap-2">
                    {alert.status === 'OPEN' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={acknowledge.isPending}
                        onClick={() => acknowledge.mutate(alert.id)}
                      >
                        Acknowledge
                      </Button>
                    )}
                    <Button
                      size="sm"
                      loading={resolve.isPending}
                      onClick={() => resolve.mutate(alert.id)}
                    >
                      Resolve
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState
          title="No alerts here"
          description={
            status
              ? `There are no ${status.toLowerCase()} alerts.`
              : 'No alerts have been recorded yet.'
          }
        />
      )}
    </div>
  )
}
