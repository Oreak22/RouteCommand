import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { parseTelemetryStreamEntry } from '../src/modules/telemetry/worker.js'

describe('telemetry stream message decoding', () => {
  it('decodes node-redis RESP3 map message fields', () => {
    const payload = {
      driverId: randomUUID(),
      point: {
        lat: 6.5244,
        lng: 3.3792,
        accuracyM: 8,
        recordedAt: new Date().toISOString(),
      },
      receivedAt: new Date().toISOString(),
      source: 'DEVICE',
      isFiltered: false,
      filterReasons: [],
    }
    const result = parseTelemetryStreamEntry({
      id: '1794920000000-0',
      message: new Map([
        ['payload', JSON.stringify(payload)],
        ['live', '1'],
      ]),
    })

    expect(result?.id).toBe('1794920000000-0')
    expect(result?.point.driverId).toBe(payload.driverId)
    expect(result?.point.point).toEqual(payload.point)
    expect(result?.point.live).toBe(true)
  })

  it('decodes plain object stream fields as well', () => {
    const payload = {
      driverId: randomUUID(),
      point: {
        lat: 6.5244,
        lng: 3.3792,
        accuracyM: 8,
        recordedAt: new Date().toISOString(),
      },
      receivedAt: new Date().toISOString(),
      source: 'DEVICE',
      isFiltered: true,
      filterReasons: ['LOW_ACCURACY'],
    }
    const result = parseTelemetryStreamEntry({
      id: '1794920000001-0',
      message: { payload: JSON.stringify(payload), live: '0' },
    })

    expect(result?.point.isFiltered).toBe(true)
    expect(result?.point.filterReasons).toEqual(['LOW_ACCURACY'])
    expect(result?.point.live).toBe(false)
  })
})
