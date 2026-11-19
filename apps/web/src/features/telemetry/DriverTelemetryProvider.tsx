import { useEffect, type ReactNode } from 'react'

import { DriverTelemetryContext } from './driver-telemetry-context'
import { useGnssTracker } from './useGnssTracker'
import { useDriverMe } from '../drivers/api/hooks'

export function DriverTelemetryProvider({ children }: { children: ReactNode }) {
  const { data: driver } = useDriverMe()
  const shiftActive = driver?.status === 'AVAILABLE' || driver?.status === 'BUSY'
  const tracker = useGnssTracker(shiftActive)
  const { captureState, stop } = tracker
  useEffect(() => {
    if (!shiftActive && captureState === 'watching') stop()
  }, [shiftActive, captureState, stop])

  return (
    <DriverTelemetryContext.Provider value={tracker}>{children}</DriverTelemetryContext.Provider>
  )
}
