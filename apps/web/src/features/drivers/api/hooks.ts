import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Driver, Vehicle } from './client'
import { fleetApi } from './client'

export const fleetKeys = {
  drivers: ['drivers'] as const,
  driver: (id: string) => ['drivers', id] as const,
  me: ['drivers', 'me'] as const,
  vehicles: ['vehicles'] as const,
}

export function useDrivers(
  filters: Record<string, string | number | boolean | undefined> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [...fleetKeys.drivers, filters],
    queryFn: () => fleetApi.drivers(filters),
    enabled,
  })
}

export function useVehicles() {
  return useQuery({ queryKey: fleetKeys.vehicles, queryFn: () => fleetApi.vehicles() })
}

export function useDriverMe() {
  return useQuery({ queryKey: fleetKeys.me, queryFn: fleetApi.me })
}

export function useFleetMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  keys: readonly (readonly unknown[])[],
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    },
  })
}

export async function setDriverCacheStatus(
  queryClient: ReturnType<typeof useQueryClient>,
  driverId: string,
  status: Driver['status'],
) {
  await queryClient.cancelQueries({ queryKey: fleetKeys.drivers })
  // The ['drivers'] prefix also matches single-driver and /me caches, whose
  // values are objects. Only transform list-query caches here.
  const previous = queryClient.getQueriesData<Driver[]>({
    queryKey: fleetKeys.drivers,
    predicate: (query) => Array.isArray(query.state.data),
  })
  for (const [key, drivers] of previous) {
    if (drivers) {
      queryClient.setQueryData<Driver[]>(
        key,
        drivers.map((driver) => (driver.id === driverId ? { ...driver, status } : driver)),
      )
    }
  }
  return previous
}

export function restoreDriverCacheStatus(
  queryClient: ReturnType<typeof useQueryClient>,
  previous: [readonly unknown[], Driver[] | undefined][] | undefined,
) {
  for (const [key, drivers] of previous ?? []) queryClient.setQueryData(key, drivers)
}

export function useDriverStatusMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ status, force = false }: { status: Driver['status']; force?: boolean }) =>
      fleetApi.updateMyStatus(status, force),
    onMutate: async ({ status }) => {
      const me = queryClient.getQueryData<Driver>(fleetKeys.me)
      const previous = me?.id ? await setDriverCacheStatus(queryClient, me.id, status) : []
      queryClient.setQueryData<Driver>(fleetKeys.me, me ? { ...me, status } : me)
      return { previous, me }
    },
    onError: (_error, _variables, context) => {
      restoreDriverCacheStatus(queryClient, context?.previous)
      queryClient.setQueryData(fleetKeys.me, context?.me)
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fleetKeys.drivers }),
        queryClient.invalidateQueries({ queryKey: fleetKeys.me }),
      ])
    },
  })
}

export function useVehicleDriverAssignment() {
  return useFleetMutation(
    ({ driverId, vehicleId }: { driverId: string; vehicleId: string | null }) =>
      fleetApi.assignVehicle(driverId, vehicleId),
    [fleetKeys.drivers, fleetKeys.vehicles],
  )
}

export function useVehicleListCache() {
  return useQueryClient().getQueryData<Vehicle[]>(fleetKeys.vehicles)
}
