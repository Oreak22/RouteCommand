import { Wifi, WifiOff } from 'lucide-react'

type ConnectionBannerProps = {
  online: boolean
  message?: string
}

export function ConnectionBanner({ online, message }: ConnectionBannerProps) {
  return (
    <div
      className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium ${online ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning'}`}
      role="status"
    >
      {online ? (
        <Wifi className="size-4" aria-hidden="true" />
      ) : (
        <WifiOff className="size-4" aria-hidden="true" />
      )}
      {message ??
        (online
          ? 'Connection restored'
          : 'You are offline. Updates will sync when connection returns.')}
    </div>
  )
}
