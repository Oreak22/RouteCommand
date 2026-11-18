import { useCallback } from 'react'

import { useToast } from '../../../components/ui/toast-context'
import { useSocketEvent } from '../../realtime/useRealtime'

export function AlertToastListener() {
  const { pushToast } = useToast()
  const onAlertCreated = useCallback(
    (alert: { type: string; severity: string }) => {
      if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
        pushToast(`${alert.severity}: ${alert.type.toLowerCase().replaceAll('_', ' ')}`, 'error')
      }
    },
    [pushToast],
  )
  useSocketEvent('alert:created', onAlertCreated)
  return null
}
