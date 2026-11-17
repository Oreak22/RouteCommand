import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '../../../components/ui/Button'
import { FormField } from '../../../components/ui/FormField'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { useToast } from '../../../components/ui/toast-context'
import { fleetApi } from '../api/client'
import type { Vehicle } from '../api/client'
import { useFleetMutation } from '../api/hooks'

export function VehicleForm({
  vehicle,
  open,
  onClose,
}: {
  vehicle: Vehicle | null
  open: boolean
  onClose: () => void
}) {
  const [plate, setPlate] = useState(vehicle?.plate ?? '')
  const [type, setType] = useState<Vehicle['type']>(vehicle?.type ?? 'VAN')
  const [capacityKg, setCapacityKg] = useState(String(vehicle?.capacityKg ?? 1000))
  const { pushToast } = useToast()
  const save = useFleetMutation(
    ({
      id,
      plate: newPlate,
      type: newType,
      capacityKg: newCapacity,
    }: {
      id: string | null
      plate: string
      type: Vehicle['type']
      capacityKg: number
    }) =>
      id
        ? fleetApi.updateVehicle(id, { plate: newPlate, type: newType, capacityKg: newCapacity })
        : fleetApi.createVehicle({ plate: newPlate, type: newType, capacityKg: newCapacity }),
    [['vehicles']],
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await save.mutateAsync({
        id: vehicle?.id ?? null,
        plate: plate.trim(),
        type,
        capacityKg: Number(capacityKg),
      })
      pushToast(vehicle ? 'Vehicle updated.' : 'Vehicle added to the fleet.', 'success')
      setPlate('')
      setType('VAN')
      setCapacityKg('1000')
      onClose()
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not save vehicle.', 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={vehicle ? 'Edit vehicle' : 'Add vehicle'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form="vehicle-form" type="submit" loading={save.isPending}>
            {vehicle ? 'Save changes' : 'Add vehicle'}
          </Button>
        </>
      }
    >
      <form id="vehicle-form" className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormField label="Plate number" required>
          <Input
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
            maxLength={32}
            autoComplete="off"
            required
          />
        </FormField>
        <FormField label="Vehicle type" required>
          <Select value={type} onChange={(event) => setType(event.target.value as Vehicle['type'])}>
            <option value="BIKE">Bike</option>
            <option value="CAR">Car</option>
            <option value="VAN">Van</option>
            <option value="TRUCK">Truck</option>
          </Select>
        </FormField>
        <FormField label="Capacity (kg)" required>
          <Input
            type="number"
            min="1"
            max="100000"
            step="1"
            value={capacityKg}
            onChange={(event) => setCapacityKg(event.target.value)}
            required
          />
        </FormField>
      </form>
    </Modal>
  )
}
