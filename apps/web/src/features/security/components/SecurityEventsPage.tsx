import { useState } from 'react'

import { PageHeader } from '../../../components/common/PageHeader'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Spinner } from '../../../components/ui/Spinner'
import { useSecurityEvents, useUpdateSecurityEvent } from '../api/hooks'

const severityOptions = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const

function title(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function SecurityEventsPage() {
  const [severity, setSeverity] = useState<(typeof severityOptions)[number]>('ALL')
  const [status, setStatus] = useState<'OPEN' | 'REVIEWED' | 'DISMISSED' | 'ALL'>('OPEN')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const query = useSecurityEvents({
    ...(severity !== 'ALL' ? { severity } : {}),
    ...(status !== 'ALL' ? { status } : {}),
  })
  const update = useUpdateSecurityEvent()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Security events"
        description="Review explainable authentication and account activity signals. High and critical events also generate administrator emails."
      />
      <div className="flex flex-wrap gap-5">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filter security event severity"
        >
          {severityOptions.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={severity === option ? 'primary' : 'secondary'}
              aria-pressed={severity === option}
              onClick={() => setSeverity(option)}
            >
              {title(option)}
            </Button>
          ))}
        </div>
        <label className="form-control max-w-48">
          <span className="label-text mb-1 text-xs">Event status</span>
          <select
            className="select select-bordered select-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="OPEN">Open</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="DISMISSED">Dismissed</option>
            <option value="ALL">All</option>
          </select>
        </label>
      </div>

      {query.isLoading ? (
        <div className="grid min-h-40 place-items-center">
          <Spinner label="Loading security events" />
        </div>
      ) : query.isError ? (
        <ErrorState
          title="Security events could not be loaded"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : query.data?.data.length ? (
        <div className="space-y-3">
          {query.data.data.map((event) => (
            <Card key={event.id} className="overflow-hidden">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{title(event.type)}</span>
                  <Badge
                    tone={
                      event.severity === 'CRITICAL' || event.severity === 'HIGH'
                        ? 'error'
                        : event.severity === 'MEDIUM'
                          ? 'warning'
                          : 'info'
                    }
                  >
                    {title(event.severity)}
                  </Badge>
                  <Badge tone={event.status === 'OPEN' ? 'warning' : 'default'}>
                    {title(event.status)}
                  </Badge>
                </div>
                <p className="text-sm text-base-content/70">
                  {[event.userName, event.ip, event.userAgent].filter(Boolean).join(' · ') ||
                    'No associated account or IP'}
                </p>
                <time className="font-data text-xs text-base-content/55" dateTime={event.createdAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(event.createdAt))}
                </time>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={selectedId === event.id}
                    onClick={() => setSelectedId(selectedId === event.id ? null : event.id)}
                  >
                    {selectedId === event.id ? 'Hide evidence' : 'View evidence'}
                  </Button>
                  {event.status === 'OPEN' && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={update.isPending}
                        onClick={() => update.mutate({ id: event.id, status: 'REVIEWED' })}
                      >
                        Mark reviewed
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={update.isPending}
                        onClick={() => update.mutate({ id: event.id, status: 'DISMISSED' })}
                      >
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
                {selectedId === event.id && (
                  <pre className="overflow-x-auto rounded-box bg-base-200 p-3 text-xs">
                    {JSON.stringify(event.evidence, null, 2)}
                  </pre>
                )}
              </div>
            </Card>
          ))}
          <p className="text-xs text-base-content/55">
            Showing {query.data.data.length} of {query.data.total} events.
          </p>
        </div>
      ) : (
        <EmptyState
          title="No security events"
          description="No events match the selected filters."
        />
      )}
      {update.isError && (
        <p role="alert" className="text-sm text-error">
          {update.error.message}
        </p>
      )}
    </div>
  )
}
