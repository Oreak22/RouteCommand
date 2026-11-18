import { useCallback } from 'react'

import { useToast } from '../../../components/ui/toast-context'
import { useSocketEvent } from '../../realtime/useRealtime'

export function ShipmentSuggestionListener() {
  const { pushToast } = useToast()
  const onSuggestion = useCallback(
    (event: { suggestedStatus: 'PICKED_UP' | 'ARRIVED' }) => {
      const status = event.suggestedStatus === 'ARRIVED' ? 'arrived at the dropoff' : 'picked up'
      pushToast(`Shipment may be ready to mark ${status}. Review it in your shipment list.`, 'info')
    },
    [pushToast],
  )
  useSocketEvent('shipment:suggestion', onSuggestion)
  return null
}
