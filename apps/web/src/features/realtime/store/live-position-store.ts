import type { DriverPositionEvent, OpsSnapshotEvent } from '@routecommand/shared'
import { create } from 'zustand'

interface LivePositionState {
  byDriverId: Record<string, DriverPositionEvent>
  applyPosition(position: DriverPositionEvent): void
  applySnapshot(snapshot: OpsSnapshotEvent): void
  clear(): void
}

export const useLivePositionStore = create<LivePositionState>((set) => ({
  byDriverId: {},
  applyPosition(position) {
    set((state) => {
      const current = state.byDriverId[position.driverId]
      if (current && current.sequence >= position.sequence) return state
      return { byDriverId: { ...state.byDriverId, [position.driverId]: position } }
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
      return { byDriverId: next }
    })
  },
  clear() {
    set({ byDriverId: {} })
  },
}))

export function useLivePosition(driverId: string | null) {
  return useLivePositionStore((state) => (driverId ? state.byDriverId[driverId] : undefined))
}
