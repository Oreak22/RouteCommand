import { ArrowUpRight, Clock3, MapPinned, PackageCheck, Truck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageHeader } from '../components/common/PageHeader'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DataTable } from '../components/ui/DataTable'
import type { DataColumn } from '../components/ui/DataTable'
import { StatCard } from '../components/ui/StatCard'
import { StatusPill } from '../components/ui/StatusPill'
import type { ShipmentStatus } from '../theme/domain-colors'

type ShipmentRow = {
  id: string
  recipient: string
  destination: string
  status: ShipmentStatus
  eta: string
}

const shipments: ShipmentRow[] = [
  {
    id: 'RC-4826-91',
    recipient: 'Tomi Adebayo',
    destination: 'Victoria Island',
    status: 'IN_TRANSIT',
    eta: '10:42',
  },
  {
    id: 'RC-4826-88',
    recipient: 'Ifeoma Nwosu',
    destination: 'Lekki Phase 1',
    status: 'ASSIGNED',
    eta: '11:05',
  },
  {
    id: 'RC-4826-84',
    recipient: 'Femi Ojo',
    destination: 'Ikeja GRA',
    status: 'CREATED',
    eta: '11:20',
  },
  {
    id: 'RC-4826-79',
    recipient: 'Zainab Bello',
    destination: 'Yaba',
    status: 'DELIVERED',
    eta: 'Complete',
  },
]

const columns: DataColumn<ShipmentRow>[] = [
  { key: 'id', header: 'Tracking ID', sortable: true, className: 'font-data text-xs' },
  { key: 'recipient', header: 'Recipient', sortable: true },
  { key: 'destination', header: 'Destination', sortable: true },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusPill category="shipment" status={row.status} />,
  },
  { key: 'eta', header: 'ETA', className: 'font-data text-xs' },
]

export function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Friday · Lagos operations"
        title="Good morning, Amara"
        description="Here’s your fleet and delivery activity at a glance."
        actions={
          <Button variant="outline">
            <ArrowUpRight className="size-4" aria-hidden="true" />
            Export overview
          </Button>
        }
      />
      <section
        className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4"
        aria-label="Operations summary"
      >
        <StatCard
          label="Active shipments"
          value="128"
          change="12 added this morning"
          trend="up"
          icon={<PackageCheck className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Drivers on duty"
          value="24 / 31"
          change="19 currently on route"
          trend="up"
          icon={<Truck className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="On-time rate"
          value="96.4%"
          change="Up 2.1% from yesterday"
          trend="up"
          icon={<Clock3 className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Coverage zones"
          value="08"
          change="All zones operational"
          trend="flat"
          icon={<MapPinned className="size-5" aria-hidden="true" />}
        />
      </section>
      <section className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Recent shipments</h2>
              <p className="mt-1 text-xs text-base-content/55">
                Latest movement across your network
              </p>
            </div>
            <Link className="btn btn-ghost btn-sm" to="/map">
              View all
            </Link>
          </div>
          <div className="mt-5">
            <DataTable rows={shipments} columns={columns} getRowId={(row) => row.id} pageSize={5} />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Fleet pulse</h2>
              <p className="mt-1 text-xs text-base-content/55">Driver availability</p>
            </div>
            <Users className="size-4 text-primary" aria-hidden="true" />
          </div>
          <div className="mt-5 space-y-4">
            {[
              ['Available', '12', 'bg-driver-available'],
              ['On delivery', '19', 'bg-driver-busy'],
              ['On break', '03', 'bg-driver-break'],
              ['Offline', '07', 'bg-driver-offline'],
            ].map(([label, count, color]) => (
              <div className="space-y-1.5" key={label}>
                <div className="flex justify-between text-xs">
                  <span className="text-base-content/65">{label}</span>
                  <span className="font-data">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-base-300">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${Number(count) * 3}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <Link
            className="mt-6 inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline"
            to="/map"
          >
            Open live map <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Card>
      </section>
    </>
  )
}
