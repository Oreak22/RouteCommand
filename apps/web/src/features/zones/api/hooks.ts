import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Zone } from './client'
import { zonesApi } from './client'

export const zoneKeys = {
  all: ['zones'] as const,
  list: (filters: object = {}) => [...zoneKeys.all, 'list', filters] as const,
  geoJson: ['zones', 'geojson'] as const,
}

export function useZones(filters: Record<string, string | number | boolean | undefined> = {}) {
  return useQuery({ queryKey: zoneKeys.list(filters), queryFn: () => zonesApi.list(filters) })
}

export function useZoneGeoJson(toleranceM = 0) {
  return useQuery({
    queryKey: [...zoneKeys.geoJson, toleranceM],
    queryFn: () => zonesApi.geoJson(toleranceM),
  })
}

function useZoneMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: zoneKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['zones'] }),
      ])
    },
  })
}

export function useCreateZone() {
  return useZoneMutation(zonesApi.create)
}

export function useUpdateZone() {
  return useZoneMutation(
    ({ id, input }: { id: string; input: Parameters<typeof zonesApi.update>[1] }) =>
      zonesApi.update(id, input),
  )
}

export function useDeactivateZone() {
  return useZoneMutation(({ id, expectedUpdatedAt }: { id: string; expectedUpdatedAt: string }) =>
    zonesApi.deactivate(id, expectedUpdatedAt),
  )
}

export function useZoneCache() {
  return useQueryClient().getQueryData<Zone[]>(zoneKeys.list())
}
