import type { PublicTrackingResponse, PublicTrackingUpdate } from '@routecommand/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleDot, Copy, PackageCheck, Search, Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { io } from 'socket.io-client'

import { PageHeader } from '../components/common/PageHeader'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatusPill } from '../components/ui/StatusPill'
import { getPublicTracking } from '../features/tracking/api/client'
import { TrackingMap } from '../features/tracking/components/TrackingMap'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'
const statusLabels: Record<string, string> = {
  CREATED: 'Shipment created',
  ASSIGNED: 'Driver assigned',
  ACCEPTED: 'Driver accepted the delivery',
  PICKED_UP: 'Parcel picked up',
  IN_TRANSIT: 'On the way to you',
  ARRIVED: 'Driver has arrived',
  DELIVERED: 'Delivered',
  CANCELLED: 'Shipment cancelled',
  FAILED_DELIVERY: 'Delivery attempt unsuccessful',
  RETURNED: 'Parcel returned',
}

function formatTime(value: string | null) {
  if (!value) return 'Not available'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

function TrackingSearch({ initialCode = '' }: { initialCode?: string }) {
  const [value, setValue] = useState(initialCode)
  const navigate = useNavigate()
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault()
        const code = value.trim().toUpperCase()
        if (code) navigate(`/track/${encodeURIComponent(code)}`)
      }}
    >
      <label className="sr-only" htmlFor="tracking-code">
        Tracking number
      </label>
      <input
        id="tracking-code"
        className="input input-bordered min-w-0 flex-1"
        autoComplete="off"
        placeholder="Enter your tracking number"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" disabled={!value.trim()}>
        <Search className="size-4" aria-hidden="true" /> Track parcel
      </Button>
    </form>
  )
}

function TrackingTimeline({ tracking }: { tracking: PublicTrackingResponse }) {
  if (tracking.events.length === 0) {
    return (
      <p className="mt-4 text-sm text-base-content/55">
        Updates will appear here as your parcel moves.
      </p>
    )
  }
  const latest = tracking.events.at(-1)
  return (
    <ol className="mt-5 space-y-0">
      {tracking.events.map((event, index) => {
        const isCurrent = event === latest
        const complete = !isCurrent || ['DELIVERED', 'CANCELLED', 'RETURNED'].includes(event.status)
        return (
          <li
            className="relative flex gap-3 pb-6 last:pb-0"
            key={`${event.status}-${event.occurredAt}`}
          >
            <span
              className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full ${complete ? 'bg-success text-success-content' : 'bg-primary text-primary-content'}`}
            >
              {complete ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <CircleDot className="size-4" aria-hidden="true" />
              )}
            </span>
            {index < tracking.events.length - 1 && (
              <span className="absolute bottom-0 left-3.5 top-7 border-l border-dashed border-base-content/20" />
            )}
            <div>
              <p className="text-sm font-medium">{statusLabels[event.status] ?? event.status}</p>
              <p className="mt-1 text-xs text-base-content/55">{formatTime(event.occurredAt)}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function PublicTrackingPage() {
  const { trackingCode } = useParams()
  const queryClient = useQueryClient()
  const code = trackingCode?.trim().toUpperCase() ?? ''
  const queryKey = useMemo(() => ['public-tracking', code], [code])
  const trackingQuery = useQuery({
    queryKey,
    queryFn: () => getPublicTracking(code),
    enabled: Boolean(code),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!code) return
    const socket = io(`${apiBase}/tracking`, {
      autoConnect: true,
      reconnection: true,
      transports: ['websocket', 'polling'],
    })
    socket.on('connect', () =>
      socket.emit('public:subscribe', { trackingCode: code }, () => undefined),
    )
    socket.on('tracking:update', (update: PublicTrackingUpdate) => {
      queryClient.setQueryData<PublicTrackingResponse>(queryKey, (current) =>
        current?.found
          ? {
              ...current,
              status: update.status,
              eta: update.eta,
              location: update.location,
              updatedAt: update.updatedAt,
            }
          : current,
      )
    })
    return () => {
      if (socket.connected)
        socket.emit('public:unsubscribe', { trackingCode: code }, () => undefined)
      socket.disconnect()
    }
  }, [code, queryClient, queryKey])

  const tracking = trackingQuery.data
  const [copied, setCopied] = useState(false)
  const share = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
  }

  if (!code) {
    return (
      <section className="mx-auto max-w-2xl">
        <PageHeader
          eyebrow="Parcel tracking"
          title="Track a delivery"
          description="Enter the tracking number from your shipment confirmation."
        />
        <Card>
          <TrackingSearch />
        </Card>
      </section>
    )
  }
  if (trackingQuery.isLoading) {
    return (
      <Card className="mx-auto max-w-xl">
        <p className="animate-pulse text-sm text-base-content/60">Loading parcel updates…</p>
      </Card>
    )
  }
  if (trackingQuery.isError) {
    return (
      <section className="mx-auto max-w-2xl">
        <PageHeader
          eyebrow="Parcel tracking"
          title="We couldn't load tracking"
          description="Check your connection and try again."
        />
        <Card>
          <TrackingSearch key={code} initialCode={code} />
          <Button className="mt-4" onClick={() => void trackingQuery.refetch()}>
            Try again
          </Button>
        </Card>
      </section>
    )
  }
  if (!tracking?.found) {
    return (
      <section className="mx-auto max-w-2xl">
        <PageHeader
          eyebrow="Parcel tracking"
          title="No shipment found"
          description="Check the tracking number and try again."
        />
        <Card>
          <TrackingSearch key={code} initialCode={code} />
          <Link className="mt-4 inline-block text-sm text-primary underline" to="/track">
            Start a new search
          </Link>
        </Card>
      </section>
    )
  }

  const delivered = tracking.status === 'DELIVERED'
  const terminalMessage: Record<string, string> = {
    DELIVERED: 'Your parcel was delivered',
    CANCELLED: 'This shipment was cancelled',
    FAILED_DELIVERY: 'The delivery attempt was unsuccessful',
    RETURNED: 'Your parcel was returned',
  }
  const terminal = terminalMessage[tracking.status]
  const driverSignalDelayed =
    tracking.location !== null &&
    trackingQuery.dataUpdatedAt - Date.parse(tracking.location.recordedAt) > 180_000
  const driverLabel = tracking.driver
    ? `${tracking.driver.firstName}${tracking.driver.vehicleType ? ` · ${tracking.driver.vehicleType.toLowerCase()}` : ''}`
    : 'Driver details will appear after assignment'
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0">
        <PageHeader
          eyebrow={terminal ? 'Delivery update' : 'Delivery in progress'}
          title={terminal ?? 'Your parcel is on its way'}
          description={
            delivered
              ? 'The final delivery location is shown below.'
              : terminal
                ? 'See the shipment timeline below for the latest update.'
                : 'This page refreshes automatically as your delivery moves.'
          }
        />
        <Card className="mb-6 overflow-hidden p-2 sm:p-3">
          <TrackingMap tracking={tracking} />
          <p className="px-2 pt-3 text-xs text-base-content/55">
            {tracking.location
              ? `${driverSignalDelayed ? 'Driver signal delayed · last known approximate position' : 'Approximate driver position'} · last update ${formatTime(tracking.location.recordedAt)}`
              : delivered
                ? 'Driver location is hidden after delivery.'
                : 'Live driver location will appear after pickup when a recent signal is available.'}
          </p>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-base-content/55">Tracking number</p>
              <p className="mt-1 font-data font-semibold">{tracking.trackingCode}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill
                category="shipment"
                status={tracking.status === 'NOT_FOUND' ? 'CREATED' : tracking.status}
                label={statusLabels[tracking.status] ?? tracking.status}
              />
              <Button variant="secondary" onClick={() => void share()}>
                <Copy className="size-4" aria-hidden="true" />
                {copied ? 'Copied' : 'Share'}
              </Button>
            </div>
          </div>
        </Card>
      </section>
      <aside className="space-y-6">
        <Card>
          <h2 className="font-semibold">Delivery estimate</h2>
          <p className="mt-3 text-lg font-semibold">
            {terminal ? (statusLabels[tracking.status] ?? terminal) : formatTime(tracking.eta)}
          </p>
          {tracking.driver && (
            <p className="mt-2 flex items-center gap-2 text-sm text-base-content/65">
              <Truck className="size-4 text-primary" aria-hidden="true" />
              {driverLabel}
            </p>
          )}
          {tracking.dropoff?.address && (
            <p className="mt-3 text-sm text-base-content/65">{tracking.dropoff.address}</p>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">Delivery updates</h2>
          <TrackingTimeline tracking={tracking} />
          <p className="mt-6 flex items-center gap-2 border-t border-base-content/10 pt-4 text-xs text-success">
            <PackageCheck className="size-4" aria-hidden="true" />
            Last shipment update {formatTime(tracking.updatedAt)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-base-content/55">Looking for another parcel?</p>
          <div className="mt-3">
            <TrackingSearch />
          </div>
        </Card>
      </aside>
    </div>
  )
}
