import {
  shipmentPriorities,
  createShipmentSchema,
  updateShipmentSchema,
} from '@routecommand/shared'
import type { CreateShipmentInput, UpdateShipmentInput } from '@routecommand/shared'
import { useState } from 'react'

import { LocationPicker } from './LocationPicker'
import { Button } from '../../../components/ui/Button'
import { FormField } from '../../../components/ui/FormField'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { Textarea } from '../../../components/ui/Textarea'
import type { Shipment, ShipmentCustomer } from '../api/client'

type Point = { lat: number; lng: number } | null

function toLocalDateTime(value: string | null | undefined) {
  if (!value) return ''
  const local = new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function ShipmentForm({
  open,
  onClose,
  isCustomer,
  customers,
  shipment,
  busy,
  error,
  onCreate,
  onUpdate,
}: {
  open: boolean
  onClose: () => void
  isCustomer: boolean
  customers: ShipmentCustomer[]
  shipment?: Shipment | null
  busy: boolean
  error?: string | null
  onCreate: (input: CreateShipmentInput) => Promise<unknown>
  onUpdate: (id: string, input: UpdateShipmentInput) => Promise<unknown>
}) {
  const [customerId, setCustomerId] = useState(shipment?.customerId ?? '')
  const [pickupAddress, setPickupAddress] = useState(shipment?.pickupAddress ?? '')
  const [dropoffAddress, setDropoffAddress] = useState(shipment?.dropoffAddress ?? '')
  const [pickup, setPickup] = useState<Point>(shipment?.pickup ?? null)
  const [dropoff, setDropoff] = useState<Point>(shipment?.dropoff ?? null)
  const [activePoint, setActivePoint] = useState<'pickup' | 'dropoff'>('pickup')
  const [weightKg, setWeightKg] = useState(String(shipment?.weightKg ?? 1))
  const [priority, setPriority] = useState<(typeof shipmentPriorities)[number]>(
    shipment?.priority ?? 'NORMAL',
  )
  const [notes, setNotes] = useState(shipment?.notes ?? '')
  const [scheduledAt, setScheduledAt] = useState(toLocalDateTime(shipment?.scheduledAt))
  const [formError, setFormError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (!pickup || !dropoff) {
      setFormError('Set both the pickup and dropoff points on the map.')
      return
    }
    const common = {
      pickupAddress,
      pickup,
      dropoffAddress,
      dropoff,
      weightKg: Number(weightKg),
      priority,
      notes: notes.trim() ? notes.trim() : null,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    }

    if (shipment) {
      const parsed = updateShipmentSchema.safeParse({
        ...common,
        customerId: isCustomer ? undefined : customerId || undefined,
      })
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? 'Check the shipment details.')
        return
      }
      try {
        await onUpdate(shipment.id, parsed.data)
        onClose()
      } catch (submitError) {
        setFormError(
          submitError instanceof Error ? submitError.message : 'Could not update the shipment.',
        )
      }
      return
    }

    const parsed = createShipmentSchema.safeParse({
      ...common,
      ...(isCustomer ? {} : { customerId }),
    })
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the shipment details.')
      return
    }
    try {
      await onCreate(parsed.data)
      onClose()
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : 'Could not create the shipment.',
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shipment ? 'Edit shipment' : 'Create shipment'}
      description={
        isCustomer
          ? 'Request a delivery for your account.'
          : 'Add a shipment to dispatch operations.'
      }
      footer={null}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {!isCustomer && (
          <FormField label="Customer" required>
            <Select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              required
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.email}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Pickup address" required>
            <Input
              value={pickupAddress}
              onChange={(event) => setPickupAddress(event.target.value)}
              required
              maxLength={500}
            />
          </FormField>
          <FormField label="Dropoff address" required>
            <Input
              value={dropoffAddress}
              onChange={(event) => setDropoffAddress(event.target.value)}
              required
              maxLength={500}
            />
          </FormField>
        </div>
        <LocationPicker
          pickup={pickup}
          dropoff={dropoff}
          activePoint={activePoint}
          onActivePointChange={setActivePoint}
          onSelect={(target, point) => (target === 'pickup' ? setPickup(point) : setDropoff(point))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Weight (kg)" required>
            <Input
              type="number"
              min="0"
              max="100000"
              step="0.01"
              value={weightKg}
              onChange={(event) => setWeightKg(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Priority">
            <Select
              value={priority}
              onChange={(event) => setPriority(event.target.value as typeof priority)}
            >
              {shipmentPriorities.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Scheduled time" hint="Optional; enter your local date and time.">
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Delivery notes">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
          />
        </FormField>
        {(formError || error) && (
          <p className="text-sm text-error" role="alert">
            {formError ?? error}
          </p>
        )}
        <div className="modal-action">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" loading={busy}>
            {shipment ? 'Save changes' : 'Create shipment'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
