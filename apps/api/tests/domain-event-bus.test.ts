import { describe, expect, it, vi } from 'vitest'

import { DomainEventBus } from '../src/core/events/domain-event-bus.js'

describe('DomainEventBus', () => {
  it('publishes only when the transaction invokes its after-commit handlers', () => {
    const bus = new DomainEventBus()
    const listener = vi.fn()
    const afterCommitHandlers: (() => void | Promise<void>)[] = []
    const removeListener = bus.subscribe('shipment.assigned', listener)

    bus.publishAfterCommit((handler) => afterCommitHandlers.push(handler), 'shipment.assigned', {
      shipmentId: 'shipment-1',
      driverId: 'driver-1',
      dispatcherId: 'dispatcher-1',
    })

    expect(listener).not.toHaveBeenCalled()
    expect(afterCommitHandlers).toHaveLength(1)

    afterCommitHandlers[0]?.()

    expect(listener).toHaveBeenCalledWith({
      shipmentId: 'shipment-1',
      driverId: 'driver-1',
      dispatcherId: 'dispatcher-1',
    })
    removeListener()
  })
})
