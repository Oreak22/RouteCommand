import {
  shipmentPriorities,
  createShipmentSchema,
  updateShipmentSchema,
} from '@routecommand/shared'
import type { CreateShipmentInput, UpdateShipmentInput } from '@routecommand/shared'
import { LocateFixed } from 'lucide-react'
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

function pointFromCoordinates(lat: string, lng: string): Point {
  if (!lat.trim() || !lng.trim()) return null
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { lat: latitude, lng: longitude }
}

function CoordinateInputs({
  prefix,
  lat,
  lng,
  onLatChange,
  onLngChange,
}: {
  prefix: string
  lat: string
  lng: string
  onLatChange: (value: string) => void
  onLngChange: (value: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <FormField label="Latitude" htmlFor={`${prefix}-latitude`}>
        <Input
          id={`${prefix}-latitude`}
          type="number"
          min="-90"
          max="90"
          step="any"
          inputMode="decimal"
          placeholder="6.5244"
          value={lat}
          onChange={(event) => onLatChange(event.target.value)}
        />
      </FormField>
      <FormField label="Longitude" htmlFor={`${prefix}-longitude`}>
        <Input
          id={`${prefix}-longitude`}
          type="number"
          min="-180"
          max="180"
          step="any"
          inputMode="decimal"
          placeholder="3.3792"
          value={lng}
          onChange={(event) => onLngChange(event.target.value)}
        />
      </FormField>
    </div>
  )
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
  const [pickupLat, setPickupLat] = useState(shipment?.pickup ? String(shipment.pickup.lat) : '')
  const [pickupLng, setPickupLng] = useState(shipment?.pickup ? String(shipment.pickup.lng) : '')
  const [dropoffLat, setDropoffLat] = useState(
    shipment?.dropoff ? String(shipment.dropoff.lat) : '',
  )
  const [dropoffLng, setDropoffLng] = useState(
    shipment?.dropoff ? String(shipment.dropoff.lng) : '',
  )
  const [activePoint, setActivePoint] = useState<'pickup' | 'dropoff'>('pickup')
  const [locating, setLocating] = useState<'pickup' | 'dropoff' | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [weightKg, setWeightKg] = useState(String(shipment?.weightKg ?? 1))
  const [priority, setPriority] = useState<(typeof shipmentPriorities)[number]>(
    shipment?.priority ?? 'NORMAL',
  )
  const [notes, setNotes] = useState(shipment?.notes ?? '')
  const [scheduledAt, setScheduledAt] = useState(toLocalDateTime(shipment?.scheduledAt))
  const [formError, setFormError] = useState<string | null>(null)

  const pickup = pointFromCoordinates(pickupLat, pickupLng)
  const dropoff = pointFromCoordinates(dropoffLat, dropoffLng)

  function setPoint(target: 'pickup' | 'dropoff', point: { lat: number; lng: number }) {
    if (target === 'pickup') {
      setPickupLat(String(point.lat))
      setPickupLng(String(point.lng))
    } else {
      setDropoffLat(String(point.lat))
      setDropoffLng(String(point.lng))
    }
  }

  function getCurrentLocation(target: 'pickup' | 'dropoff') {
    setLocationError(null)
    if (!navigator.geolocation) {
      setLocationError(
        'Location is unavailable in this browser. Enter coordinates or choose a map point.',
      )
      return
    }
    setLocating(target)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPoint(target, { lat: coords.latitude, lng: coords.longitude })
        setLocating(null)
      },
      (error) => {
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied. Allow access in your browser or enter coordinates.'
            : error.code === error.TIMEOUT
              ? 'Could not get your location in time. Try again or enter coordinates.'
              : 'Could not get your location. Enter coordinates or choose a map point.',
        )
        setLocating(null)
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    )
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (!pickup || !dropoff) {
      setFormError(
        'Enter valid pickup and dropoff coordinates, choose them on the map, or use your location.',
      )
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
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="space-y-2 rounded-box border border-base-300 p-3">
            <legend className="px-1 text-sm font-medium">Pickup coordinates</legend>
            <CoordinateInputs
              prefix="pickup"
              lat={pickupLat}
              lng={pickupLng}
              onLatChange={setPickupLat}
              onLngChange={setPickupLng}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={locating === 'pickup'}
              disabled={locating !== null}
              onClick={() => getCurrentLocation('pickup')}
            >
              <LocateFixed className="size-4" aria-hidden="true" /> Use my location
            </Button>
          </fieldset>
          <fieldset className="space-y-2 rounded-box border border-base-300 p-3">
            <legend className="px-1 text-sm font-medium">Dropoff coordinates</legend>
            <CoordinateInputs
              prefix="dropoff"
              lat={dropoffLat}
              lng={dropoffLng}
              onLatChange={setDropoffLat}
              onLngChange={setDropoffLng}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={locating === 'dropoff'}
              disabled={locating !== null}
              onClick={() => getCurrentLocation('dropoff')}
            >
              <LocateFixed className="size-4" aria-hidden="true" /> Use my location
            </Button>
          </fieldset>
        </div>
        {locationError && (
          <p className="text-sm text-error" role="alert">
            {locationError}
          </p>
        )}
        <LocationPicker
          pickup={pickup}
          dropoff={dropoff}
          activePoint={activePoint}
          onActivePointChange={setActivePoint}
          onSelect={setPoint}
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
