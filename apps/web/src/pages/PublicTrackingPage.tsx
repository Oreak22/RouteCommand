import { Check, CircleDot, MapPin, PackageCheck, Truck } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { PageHeader } from '../components/common/PageHeader'
import { Card } from '../components/ui/Card'
import { StatusPill } from '../components/ui/StatusPill'

const events = [
  { title: 'Parcel picked up', detail: 'Victoria Island dispatch hub · 09:12', done: true },
  { title: 'On the way to you', detail: 'Driver Chidi is making the delivery · 09:28', done: true },
  { title: 'Arriving soon', detail: 'Estimated arrival between 10:40 and 11:00', done: false },
]

export function PublicTrackingPage() {
  const { trackingCode = 'RC-4826-91' } = useParams()

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section>
        <PageHeader
          eyebrow="Delivery in progress"
          title="Your parcel is on the way"
          description="We’ll keep this page updated as your delivery moves."
        />
        <Card className="mb-6 overflow-hidden p-0">
          <div className="grid min-h-72 place-items-center bg-base-300 p-6 text-center">
            <div>
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary/15 text-primary">
                <Truck aria-hidden="true" />
              </span>
              <p className="mt-4 font-medium">Live delivery map</p>
              <p className="mt-1 text-xs text-base-content/55">
                Map and driver location will appear when tracking is connected.
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-base-content/55">Tracking number</p>
              <p className="mt-1 font-data font-semibold">{trackingCode}</p>
            </div>
            <StatusPill category="shipment" status="IN_TRANSIT" label="In transit" />
          </div>
        </Card>
      </section>
      <aside>
        <Card>
          <h2 className="font-semibold">Delivery updates</h2>
          <ol className="mt-5 space-y-0">
            {events.map((event, index) => (
              <li className="relative flex gap-3 pb-6 last:pb-0" key={event.title}>
                <span
                  className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full ${event.done ? 'bg-success text-success-content' : 'bg-primary text-primary-content'}`}
                >
                  {event.done ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <CircleDot className="size-4" aria-hidden="true" />
                  )}
                </span>
                {index < events.length - 1 && (
                  <span className="absolute bottom-0 left-3.5 top-7 border-l border-dashed border-base-content/20" />
                )}
                <div>
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-base-content/55">
                    {event.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex items-start gap-2 border-t border-base-content/10 pt-4 text-xs text-base-content/55">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <p>Delivering to 22 Admiralty Way, Lekki Phase 1</p>
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-success">
            <PackageCheck className="size-4" aria-hidden="true" />
            Tracking is active
          </p>
        </Card>
      </aside>
    </div>
  )
}
