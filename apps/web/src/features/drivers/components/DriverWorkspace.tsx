import { DriverStatusToggle } from './DriverStatusToggle'
import { DriverJobsOverview } from './DriverJobsOverview'
import { PageHeader } from '../../../components/common/PageHeader'
import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { StatusPill } from '../../../components/ui/StatusPill'
import { DriverTelemetryCard } from '../../telemetry/components/DriverTelemetryCard'
import { useDriverMe } from '../api/hooks'

export function DriverWorkspace() {
  const { data: driver, isPending, isError, refetch } = useDriverMe()
  if (isPending)
    return (
      <p className="py-16 text-center text-sm text-base-content/60" role="status">
        Loading your driver profile…
      </p>
    )
  if (isError)
    return (
      <ErrorState
        title="Driver profile could not be loaded"
        description="Check your connection and try again."
        onRetry={() => void refetch()}
      />
    )
  if (!driver)
    return (
      <EmptyState
        title="Driver profile not found"
        description="Ask an administrator to provision a driver profile for your account."
      />
    )
  const signal =
    driver.signalState === 'NO_SIGNAL'
      ? 'No signal recorded yet'
      : driver.signalState === 'SIGNAL_LOST'
        ? 'Signal lost · last seen more than a few minutes ago'
        : `Last signal ${new Date(driver.lastSeenAt!).toLocaleString()}`
  return (
    <>
      <PageHeader
        eyebrow="Driver workspace"
        title={`Welcome, ${driver.name}`}
        description="Review assigned jobs, manage your shift, and keep location updates in sync."
      />
      <div className="space-y-4">
        <DriverJobsOverview />
        <DriverTelemetryCard driver={driver} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <DriverStatusToggle driver={driver} />
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wider text-base-content/55">
            Current assignment
          </p>
          <p className="mt-2 font-semibold">{driver.vehiclePlate ?? 'No vehicle assigned'}</p>
          <p className="mt-1 text-sm text-base-content/60">
            {driver.vehicleType ?? 'Vehicle assignment pending'}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusPill category="driver" status={driver.status} />
            <span
              className={`text-xs ${driver.signalState === 'LIVE' ? 'text-success' : 'text-warning'}`}
            >
              {signal}
            </span>
          </div>
        </Card>
      </div>
      <Card className="mt-5">
        <h2 className="font-semibold">Driver profile</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-base-content/55">Email</dt>
            <dd className="mt-1 break-all">{driver.email}</dd>
          </div>
          <div>
            <dt className="text-base-content/55">License number</dt>
            <dd className="mt-1 break-all font-data">{driver.licenseNo}</dd>
          </div>
          <div>
            <dt className="text-base-content/55">Rating</dt>
            <dd className="mt-1">
              {driver.rating === null ? 'Not rated yet' : driver.rating.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt className="text-base-content/55">Status since</dt>
            <dd className="mt-1">{new Date(driver.statusChangedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </Card>
    </>
  )
}
