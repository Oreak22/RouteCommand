import { createContext, useContext, useEffect, type ReactNode } from 'react'

import { useDriverMe } from '../drivers/api/hooks'
import { useGnssTracker } from './useGnssTracker'

type DriverTracker = ReturnType<typeof useGnssTracker>
const DriverTelemetryContext = createContext<DriverTracker | null>(null)

export function DriverTelemetryProvider({ children }: { children: ReactNode }) {
  const { data: driver } = useDriverMe()
  const shiftActive = driver?.status === 'AVAILABLE' || driver?.status === 'BUSY'
  const tracker = useGnssTracker(shiftActive)
  useEffect(() => {
    if (!shiftActive && tracker.captureState === 'watching') tracker.stop()
  }, [shiftActive, tracker.captureState, tracker.stop])

  return (
    <DriverTelemetryContext.Provider value={tracker}>{children}</DriverTelemetryContext.Provider>
  )
}

export function useDriverTelemetry() {
  const tracker = useContext(DriverTelemetryContext)
  if (!tracker) {
    throw new Error('Driver telemetry must be used inside DriverTelemetryProvider.')
  }
  return tracker
}
