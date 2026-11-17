import { useState } from 'react'

import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { FormField } from '../../../components/ui/FormField'
import { Select } from '../../../components/ui/Select'
import { useToast } from '../../../components/ui/toast-context'
import type { Driver } from '../api/client'
import { useDriverStatusMutation } from '../api/hooks'

type Status = Exclude<Driver['status'], 'BUSY'>

interface ApiError extends Error {
  status?: number
  details?: { reason?: string; activeShipmentCount?: number }
}

export function DriverStatusToggle({ driver }: { driver: Driver }) {
  const [status, setStatus] = useState<Status>(
    driver.status === 'BUSY' ? 'AVAILABLE' : driver.status,
  )
  const [confirmOffline, setConfirmOffline] = useState(false)
  const mutation = useDriverStatusMutation()
  const { pushToast } = useToast()

  async function update(force = false) {
    try {
      const updated = await mutation.mutateAsync({ status, force })
      setStatus(updated.status === 'BUSY' ? 'AVAILABLE' : updated.status)
      setConfirmOffline(false)
      pushToast('Availability updated.', 'success')
    } catch (error) {
      const apiError = error as ApiError
      if (
        status === 'OFFLINE' &&
        apiError.status === 409 &&
        apiError.details?.reason === 'ACTIVE_SHIPMENTS'
      ) {
        setConfirmOffline(true)
        return
      }
      pushToast(apiError.message || 'Could not update availability.', 'error')
    }
  }

  return (
    <>
      <Card className="border-primary/20 bg-primary/5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-48 flex-1">
            <FormField label="Availability" hint="Busy status is controlled by assigned work.">
              <Select
                className="mt-3 max-w-xs"
                value={status}
                onChange={(event) => setStatus(event.target.value as Status)}
              >
                <option value="AVAILABLE">Available</option>
                <option value="ON_BREAK">On break</option>
                <option value="OFFLINE">Offline</option>
              </Select>
            </FormField>
          </div>
          <Button
            size="sm"
            loading={mutation.isPending}
            disabled={status === driver.status}
            onClick={() => void update()}
          >
            Update status
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmOffline}
        title="Go offline with active shipments?"
        message={`You still have ${(mutation.error as ApiError | null)?.details?.activeShipmentCount ?? 1} active shipment(s). Going offline may interrupt dispatch monitoring. Confirm only if this is intended.`}
        confirmLabel="Go offline anyway"
        busy={mutation.isPending}
        onCancel={() => setConfirmOffline(false)}
        onConfirm={() => void update(true)}
      />
    </>
  )
}
