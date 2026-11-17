import { useRealtime } from './useRealtime'
import { ConnectionBanner } from '../../components/ui/ConnectionBanner'

export function RealtimeConnectionBanner() {
  const { status } = useRealtime()
  return (
    <ConnectionBanner
      online={status === 'connected'}
      message={
        status === 'connected'
          ? 'Live updates connected'
          : status === 'connecting'
            ? 'Connecting to live updates…'
            : 'Live updates interrupted. Reconnecting…'
      }
    />
  )
}
