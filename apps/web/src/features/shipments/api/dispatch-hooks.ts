import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { dispatchApi } from './dispatch-client'

export function useDispatchSuggestions(shipmentId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'suggestions', shipmentId],
    queryFn: () => dispatchApi.suggestions(shipmentId!),
    enabled: shipmentId !== null,
    staleTime: 10_000,
  })
}

export function useAssignDispatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ shipmentId, driverId }: { shipmentId: string; driverId: string }) =>
      dispatchApi.assign(shipmentId, driverId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['shipments'] }),
        queryClient.invalidateQueries({ queryKey: ['dispatch'] }),
      ])
    },
  })
}

export function useAssignDispatchBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ shipmentIds, driverId }: { shipmentIds: string[]; driverId: string }) =>
      dispatchApi.assignBatch(shipmentIds, driverId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['shipments'] }),
        queryClient.invalidateQueries({ queryKey: ['dispatch'] }),
      ])
    },
  })
}
