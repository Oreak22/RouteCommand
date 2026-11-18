import type { DriverPositionEvent, OpsSnapshotEvent } from '@routecommand/shared'
import { create } from 'zustand'

interface LivePositionState {
  byDriverId: Record<string, DriverPositionEvent>
  trailByDriverId: Record<string, DriverPositionEvent[]>
  applyPosition(position: DriverPositionEvent): void
  applySnapshot(snapshot: OpsSnapshotEvent): void
  removePositions(driverIds: string[]): void
  clear(): void
}

export const useLivePositionStore = create<LivePositionState>((set) => ({
  byDriverId: {},
  trailByDriverId: {},
  applyPosition(position) {
    set((state) => {
      const current = state.byDriverId[position.driverId]
      if (current && current.sequence >= position.sequence) return state
      const cutoff = Date.now() - 10 * 60_000
      const trail = (state.trailByDriverId[position.driverId] ?? []).filter(
        (point) => Date.parse(point.receivedAt) >= cutoff,
      )
      trail.push(position)
      if (trail.length > 600) trail.splice(0, trail.length - 600)
      return {
        byDriverId: { ...state.byDriverId, [position.driverId]: position },
        trailByDriverId: { ...state.trailByDriverId, [position.driverId]: trail },
      }
    })
  },
  applySnapshot(snapshot) {
    set((state) => {
      const next: Record<string, DriverPositionEvent> = {}
      for (const position of snapshot.positions) {
        const current = state.byDriverId[position.driverId]
        next[position.driverId] =
          current && current.sequence >= position.sequence ? current : position
      }
      for (const [driverId, current] of Object.entries(state.byDriverId)) {
        if (!next[driverId] && Date.parse(current.receivedAt) > Date.parse(snapshot.generatedAt)) {
          next[driverId] = current
        }
      }
      const cutoff = Date.now() - 10 * 60_000
      const trails = { ...state.trailByDriverId }
      for (const position of snapshot.positions) {
        const current = state.byDriverId[position.driverId]
        if (!current || position.sequence > current.sequence) {
          trails[position.driverId] = [
            ...(trails[position.driverId] ?? []).filter(
              (point) => Date.parse(point.receivedAt) >= cutoff,
            ),
            position,
          ].slice(-600)
        }
      }
      return { byDriverId: next, trailByDriverId: trails }
    })
  },
  removePositions(driverIds) {
    if (!driverIds.length) return
    set((state) => {
      const positions = { ...state.byDriverId }
      const trails = { ...state.trailByDriverId }
      for (const driverId of driverIds) {
        delete positions[driverId]
        delete trails[driverId]
      }
      return { byDriverId: positions, trailByDriverId: trails }
    })
  },
  clear() {
    set({ byDriverId: {}, trailByDriverId: {} })
  },
}))

export function useLivePosition(driverId: string | null) {
  return useLivePositionStore((state) => (driverId ? state.byDriverId[driverId] : undefined))
}

export function livePositionTrail(driverId: string): DriverPositionEvent[] {
  return useLivePositionStore.getState().trailByDriverId[driverId] ?? []
}
