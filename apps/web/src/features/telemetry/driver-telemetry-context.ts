import { createContext, useContext } from 'react'

import type { useGnssTracker } from './useGnssTracker'

type DriverTracker = ReturnType<typeof useGnssTracker>

export const DriverTelemetryContext = createContext<DriverTracker | null>(null)

export function useDriverTelemetry() {
  const tracker = useContext(DriverTelemetryContext)
  if (!tracker) {
    throw new Error('Driver telemetry must be used inside DriverTelemetryProvider.')
  }
  return tracker
}
