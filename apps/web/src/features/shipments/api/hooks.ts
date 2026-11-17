import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Shipment, ShipmentEvent } from './client'
import { shipmentsApi } from './client'

export const shipmentKeys = {
  all: ['shipments'] as const,
  list: (filters: Record<string, unknown>) => [...shipmentKeys.all, 'list', filters] as const,
  detail: (id: string) => [...shipmentKeys.all, 'detail', id] as const,
  events: (id: string) => [...shipmentKeys.all, 'events', id] as const,
  customers: ['shipments', 'customers'] as const,
}

export function useShipments(filters: Record<string, string | number | undefined> = {}) {
  return useQuery({
    queryKey: shipmentKeys.list(filters),
    queryFn: () => shipmentsApi.list(filters),
  })
}

export function useShipment(id: string | null) {
  return useQuery({
    queryKey: shipmentKeys.detail(id ?? ''),
    queryFn: () => shipmentsApi.detail(id!),
    enabled: id !== null,
  })
}

export function useShipmentEvents(id: string | null) {
  return useQuery({
    queryKey: shipmentKeys.events(id ?? ''),
    queryFn: () => shipmentsApi.events(id!),
    enabled: id !== null,
  })
}

export function useShipmentCustomers(search = '', enabled = true) {
  return useQuery({
    queryKey: [...shipmentKeys.customers, search],
    queryFn: () => shipmentsApi.customers(search),
    enabled,
  })
}

function useShipmentMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
    },
  })
}

export function useCreateShipment() {
  return useShipmentMutation(shipmentsApi.create)
}

export function useUpdateShipment() {
  return useShipmentMutation(
    ({ id, input }: { id: string; input: Parameters<typeof shipmentsApi.update>[1] }) =>
      shipmentsApi.update(id, input),
  )
}

export function useTransitionShipment() {
  return useShipmentMutation(
    ({
      id,
      input,
      key,
    }: {
      id: string
      input: Parameters<typeof shipmentsApi.transition>[1]
      key: string
    }) => shipmentsApi.transition(id, input, key),
  )
}

export function useCancelShipment() {
  return useShipmentMutation(
    ({ id, input }: { id: string; input: Parameters<typeof shipmentsApi.cancel>[1] }) =>
      shipmentsApi.cancel(id, input),
  )
}

export type { Shipment, ShipmentEvent }
