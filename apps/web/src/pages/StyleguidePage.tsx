import { Activity, ArrowUpRight, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader } from '../components/common/PageHeader'
import {
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  Combobox,
  ConfirmDialog,
  CopyButton,
  DataTable,
  Drawer,
  Dropdown,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  Input,
  Kbd,
  Modal,
  PasswordInput,
  RadioGroup,
  SearchBar,
  Select,
  Skeleton,
  Spinner,
  StatCard,
  StatusPill,
  Stepper,
  Tabs,
  Textarea,
  Toggle,
  Tooltip,
  useToast,
} from '../components/ui'
import type { DataColumn } from '../components/ui/DataTable'
import { themeNames } from '../theme/daisyui.config'

type SampleRow = {
  id: string
  route: string
  driver: string
  status: 'IN_TRANSIT' | 'ASSIGNED' | 'DELIVERED'
}

const sampleRows: SampleRow[] = [
  { id: 'RC-4826-91', route: 'VI → Lekki', driver: 'Chidi Nwosu', status: 'IN_TRANSIT' },
  { id: 'RC-4826-88', route: 'Ikeja → Yaba', driver: 'Tomi Adebayo', status: 'ASSIGNED' },
  { id: 'RC-4826-84', route: 'Surulere → Apapa', driver: 'Ifeoma Nwosu', status: 'DELIVERED' },
]

const columns: DataColumn<SampleRow>[] = [
  { key: 'id', header: 'Tracking ID', sortable: true, className: 'font-data text-xs' },
  { key: 'route', header: 'Route', sortable: true },
  { key: 'driver', header: 'Driver', sortable: true },
  {
    key: 'status',
    header: 'Status',
    render: (row: SampleRow) => <StatusPill category="shipment" status={row.status} />,
  },
]

export function StyleguidePage() {
  const { pushToast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [radio, setRadio] = useState('map')
  const [toggle, setToggle] = useState(true)

  return (
    <div>
      <PageHeader
        eyebrow="Developer reference"
        title="Interface styleguide"
        description="Shared tokens, layouts, and UI primitives. Use these building blocks before adding feature-specific UI."
        breadcrumbs={[{ label: 'Developer tools', to: '/app/dashboard' }, { label: 'Styleguide' }]}
      />

      <section className="mb-8 grid gap-4 md:grid-cols-2" aria-label="Theme previews">
        {[themeNames.dark, themeNames.light].map((theme) => (
          <Card className="overflow-hidden p-0" data-theme={theme} key={theme}>
            <div className="border-b border-base-content/10 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                Theme preview
              </p>
              <h2 className="mt-1 font-semibold">
                {theme === themeNames.dark ? 'Operations dark' : 'Operations light'}
              </h2>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                <Button size="sm">Primary</Button>
                <Button size="sm" variant="outline">
                  Secondary
                </Button>
                <Badge tone="success">Operational</Badge>
                <Badge tone="warning">Attention</Badge>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {['bg-primary', 'bg-secondary', 'bg-accent', 'bg-neutral'].map((color) => (
                  <span className={`${color} h-8 rounded-field`} key={color} />
                ))}
              </div>
              <p className="font-data text-xs text-base-content/65">
                GNSS 6.5244° N, 3.3792° E · 08:42:16Z
              </p>
            </div>
          </Card>
        ))}
      </section>

      <div className="space-y-6">
        <section className="grid gap-6 xl:grid-cols-2" aria-labelledby="buttons-heading">
          <Card>
            <h2 className="text-base font-semibold" id="buttons-heading">
              Actions and feedback
            </h2>
            <p className="mt-1 text-xs text-base-content/55">
              Buttons, icon actions, badges, status, progress and notifications.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button>Primary action</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Quiet</Button>
              <Button variant="danger">Danger</Button>
              <Button loading>Saving</Button>
              <Button disabled>Disabled</Button>
              <IconButton aria-label="Activity">
                <Activity aria-hidden="true" />
              </IconButton>
              <Tooltip label="Open live map">
                <Button variant="outline">
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                  Map
                </Button>
              </Tooltip>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Badge>Neutral</Badge>
              <Badge tone="primary">Primary</Badge>
              <Badge tone="success">Success</Badge>
              <Badge tone="warning">Warning</Badge>
              <Badge tone="error">Error</Badge>
              <Badge tone="info">Info</Badge>
              <StatusPill category="driver" status="AVAILABLE" />
              <StatusPill category="driver" status="BUSY" />
              <StatusPill category="driver" status="OFFLINE" />
              <StatusPill category="driver" status="ON_BREAK" />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-5">
              <Spinner />
              <Spinner size="sm" label="Small loading indicator" />
              <Skeleton className="h-8 w-32" />
              <Kbd>⌘ K</Kbd>
              <CopyButton value="RC-4826-91" />
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => pushToast('Changes saved successfully.', 'success')}
              >
                Success toast
              </Button>
              <Button
                variant="outline"
                onClick={() => pushToast('Connection interrupted.', 'error')}
              >
                Error toast
              </Button>
              <Button variant="outline" onClick={() => pushToast('Route updated.', 'info')}>
                Info toast
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-semibold">Typography and identity</h2>
            <p className="mt-1 text-xs text-base-content/55">
              Inter for interface copy, IBM Plex Mono for operational data.
            </p>
            <div className="mt-5 space-y-3">
              <p className="text-3xl font-semibold tracking-tight">Command with clarity</p>
              <p className="text-sm text-base-content/65">
                A delivery operations system for the people moving every parcel.
              </p>
              <div className="flex items-center gap-3">
                <Avatar name="Amara Okafor" />
                <div>
                  <p className="text-sm font-medium">Amara Okafor</p>
                  <p className="text-xs text-base-content/55">Dispatcher · Lagos</p>
                </div>
                <Avatar name="Chidi Nwosu" size="sm" />
                <Avatar name="Tomi Adebayo" size="lg" />
              </div>
              <p className="font-data text-sm">RC-4826-91 · 6.5244, 3.3792 · 08:42Z</p>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Active drivers"
                value="24"
                change="19 on route"
                trend="up"
                icon={<Truck className="size-5" aria-hidden="true" />}
              />
              <Card>
                <p className="text-sm font-semibold">Panel card</p>
                <p className="mt-1 text-xs text-base-content/55">
                  Use a shared surface for related content.
                </p>
              </Card>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-2" aria-labelledby="forms-heading">
          <Card>
            <h2 className="text-base font-semibold" id="forms-heading">
              Forms and selection
            </h2>
            <p className="mt-1 text-xs text-base-content/55">
              Labels, hints, validation and touch-friendly controls.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <FormField
                label="Search the fleet"
                htmlFor="style-search"
                hint="Search by name, route or tracking ID."
              >
                <SearchBar id="style-search" label="Find a driver" />
              </FormField>
              <FormField label="Assigned dispatcher" htmlFor="style-combobox">
                <Combobox
                  id="style-combobox"
                  options={['Amara Okafor', 'Tomi Adebayo', 'Chidi Nwosu']}
                  placeholder="Choose a dispatcher"
                />
              </FormField>
              <FormField label="Email address" htmlFor="style-email" required>
                <Input id="style-email" type="email" placeholder="name@routecommand.com" />
              </FormField>
              <FormField
                label="Password"
                htmlFor="style-password"
                error="Use at least 12 characters."
              >
                <PasswordInput id="style-password" defaultValue="demo-password" />
              </FormField>
              <FormField label="Dispatch note" htmlFor="style-note">
                <Textarea id="style-note" placeholder="Add a note for the driver…" />
              </FormField>
              <FormField label="Delivery zone" htmlFor="style-zone">
                <Select id="style-zone" defaultValue="">
                  <option value="" disabled>
                    Select a zone
                  </option>
                  <option>Victoria Island</option>
                  <option>Lekki Phase 1</option>
                </Select>
              </FormField>
            </div>
            <div className="mt-5 flex flex-wrap gap-6">
              <Checkbox label="Keep me signed in" defaultChecked />
              <Toggle
                label="Location sharing"
                checked={toggle}
                onChange={(event) => setToggle(event.target.checked)}
              />
            </div>
            <div className="mt-5">
              <RadioGroup
                name="map-style"
                label="Map base layer"
                options={[
                  { value: 'map', label: 'Street map' },
                  { value: 'satellite', label: 'Satellite imagery' },
                ]}
                value={radio}
                onChange={setRadio}
              />
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-semibold">Tabs and menus</h2>
            <p className="mt-1 text-xs text-base-content/55">
              Keyboard-operable tab navigation and compact action menus.
            </p>
            <div className="mt-5">
              <Tabs
                label="Styleguide examples"
                items={[
                  {
                    id: 'status',
                    label: 'Statuses',
                    content: (
                      <div className="flex flex-wrap gap-2">
                        <StatusPill category="shipment" status="CREATED" />
                        <StatusPill category="shipment" status="ASSIGNED" />
                        <StatusPill category="shipment" status="IN_TRANSIT" />
                        <StatusPill category="shipment" status="DELIVERED" />
                        <StatusPill category="shipment" status="CANCELLED" />
                      </div>
                    ),
                  },
                  {
                    id: 'alerts',
                    label: 'Alerts',
                    content: (
                      <div className="flex flex-wrap gap-2">
                        <StatusPill category="alert" status="LOW" />
                        <StatusPill category="alert" status="MEDIUM" />
                        <StatusPill category="alert" status="HIGH" />
                        <StatusPill category="alert" status="CRITICAL" />
                      </div>
                    ),
                  },
                  {
                    id: 'zones',
                    label: 'Zones',
                    content: (
                      <div className="flex flex-wrap gap-2">
                        <StatusPill category="zone" status="DELIVERY" />
                        <StatusPill category="zone" status="RESTRICTED" />
                        <StatusPill category="zone" status="DEPOT" />
                        <StatusPill category="zone" status="CUSTOM" />
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Dropdown
                label="Shipment actions"
                items={[
                  {
                    label: 'Assign driver',
                    onSelect: () => pushToast('Driver assignment is a future workflow.', 'info'),
                  },
                  {
                    label: 'Copy tracking link',
                    onSelect: () => pushToast('Tracking link copied.', 'success'),
                  },
                ]}
              />
              <Button variant="outline" onClick={() => setDrawerOpen(true)}>
                Open drawer
              </Button>
              <Button variant="outline" onClick={() => setModalOpen(true)}>
                Open modal
              </Button>
              <Button variant="outline" onClick={() => setConfirmOpen(true)}>
                Confirm dialog
              </Button>
            </div>
          </Card>
        </section>

        <section
          className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.7fr)]"
          aria-labelledby="data-heading"
        >
          <Card>
            <h2 className="text-base font-semibold" id="data-heading">
              Data display
            </h2>
            <p className="mt-1 text-xs text-base-content/55">
              Sortable columns, pagination, empty and loading states.
            </p>
            <div className="mt-5">
              <DataTable<SampleRow>
                columns={columns}
                rows={sampleRows}
                getRowId={(row) => row.id}
                pageSize={2}
              />
            </div>
          </Card>
          <div className="space-y-6">
            <Card>
              <h2 className="text-base font-semibold">Delivery progression</h2>
              <div className="mt-5">
                <Stepper
                  currentStep={2}
                  steps={[
                    { label: 'Created', detail: '09:02' },
                    { label: 'Picked up', detail: '09:12' },
                    { label: 'In transit', detail: '09:28' },
                    { label: 'Delivered' },
                  ]}
                  orientation="vertical"
                />
              </div>
            </Card>
            <Card>
              <EmptyState
                title="No active alerts"
                description="New operational alerts will be listed here."
              />
            </Card>
            <Card>
              <ErrorState
                description="The live service is not connected in the styleguide."
                onRetry={() => pushToast('Retry queued.', 'info')}
              />
            </Card>
          </div>
        </section>

        <section
          className="grid gap-6 xl:grid-cols-2"
          aria-label="Navigation and layout primitives"
        >
          <Card>
            <h2 className="text-base font-semibold">Navigation context</h2>
            <div className="mt-4">
              <Breadcrumbs
                items={[
                  { label: 'Operations', to: '/app/dashboard' },
                  { label: 'Shipments', to: '/map' },
                  { label: 'RC-4826-91' },
                ]}
              />
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => pushToast('Keyboard shortcut: ⌘ K', 'info')}>
                Search <Kbd>⌘ K</Kbd>
              </Button>
              <Link className="btn btn-ghost" to="/map">
                Open map
              </Link>
            </div>
          </Card>
          <Card>
            <h2 className="text-base font-semibold">Table loading and empty states</h2>
            <div className="mt-4">
              <DataTable<SampleRow>
                columns={columns}
                rows={[]}
                getRowId={(row) => row.id}
                emptyTitle="No shipments match"
              />
            </div>
            <div className="mt-4">
              <DataTable<SampleRow>
                columns={columns}
                rows={[]}
                getRowId={(row) => row.id}
                loading
              />
            </div>
          </Card>
        </section>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Interface dialog"
        description="A shared modal surface with an accessible title and close control."
        footer={<Button onClick={() => setModalOpen(false)}>Done</Button>}
      >
        <p className="text-sm text-base-content/70">
          Use dialogs for focused decisions. Keep the message short and action clear.
        </p>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm delivery reassignment"
        message="The new driver will be notified about this assignment."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          pushToast('Assignment confirmed.', 'success')
        }}
        confirmLabel="Reassign"
      />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Filter shipments">
        <p className="text-sm text-base-content/65">
          Drawer content can hold filters, details, or mobile navigation.
        </p>
        <Button className="mt-5" onClick={() => setDrawerOpen(false)}>
          Apply filters
        </Button>
      </Drawer>
    </div>
  )
}
