import { zoneTypes } from '@routecommand/shared'
import type { ZoneGeometry } from '@routecommand/shared'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '../../../components/ui/Button'
import { Drawer } from '../../../components/ui/Drawer'
import { FormField } from '../../../components/ui/FormField'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { useToast } from '../../../components/ui/toast-context'
import { Toggle } from '../../../components/ui/Toggle'
import type { Zone } from '../api/client'
import { useCreateZone, useUpdateZone } from '../api/hooks'
import { getZoneGeometryIssue } from '../geometry'

export function ZoneForm({
  zone,
  geometry,
  open,
  onClose,
}: {
  zone: Zone | null
  geometry: ZoneGeometry | null
  open: boolean
  onClose: () => void
}) {
  const [name, setName] = useState(zone?.name ?? '')
  const [type, setType] = useState<Zone['type']>(zone?.type ?? 'DELIVERY')
  const [color, setColor] = useState(zone?.color ?? '#168B91')
  const [isActive, setIsActive] = useState(zone?.isActive ?? true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { pushToast } = useToast()
  const create = useCreateZone()
  const update = useUpdateZone()
  const geometryIssue = useMemo(
    () => (geometry ? getZoneGeometryIssue(geometry) : null),
    [geometry],
  )
  const saving = create.isPending || update.isPending

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaveError(null)
    try {
      if (zone) {
        await update.mutateAsync({
          id: zone.id,
          input: {
            expectedUpdatedAt: zone.updatedAt,
            name: name.trim(),
            type,
            color,
            isActive,
          },
        })
        pushToast('Zone updated.', 'success')
      } else {
        if (!geometry) {
          setSaveError('Draw a boundary on the map before saving this zone.')
          return
        }
        if (geometryIssue) {
          setSaveError(geometryIssue)
          return
        }
        await create.mutateAsync({ name: name.trim(), type, color, isActive, geometry })
        pushToast('Zone created.', 'success')
      }
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the zone.'
      setSaveError(message)
      pushToast(message, 'error')
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={zone ? 'Edit zone details' : 'New zone'}
      side="right"
    >
      <form className="flex h-full flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-base-content/65">
          {zone
            ? 'Update the zone details. Edit its boundary with the map toolbar.'
            : 'Set a name and type for the boundary you drew on the map.'}
        </p>
        <FormField label="Zone name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </FormField>
        <FormField label="Zone type" required>
          <Select value={type} onChange={(event) => setType(event.target.value as Zone['type'])}>
            {zoneTypes.map((zoneType) => (
              <option key={zoneType} value={zoneType}>
                {zoneType.toLowerCase().replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Map colour" hint="Used for this boundary on the operational map.">
          <Input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-11 p-1"
          />
        </FormField>
        <Toggle
          label="Zone is active"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        {geometryIssue && !zone && (
          <p className="text-sm text-warning" role="status">
            {geometryIssue}
          </p>
        )}
        {saveError && (
          <p className="text-sm text-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="mt-auto flex justify-end gap-2 border-t border-base-content/10 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!zone && (!geometry || !!geometryIssue)}>
            {zone ? 'Save changes' : 'Save zone'}
          </Button>
        </div>
      </form>
    </Drawer>
  )
}
