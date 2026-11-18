import type { CityResponse, Reader } from 'maxmind'
import { open, validate } from 'maxmind'

import { env } from '../config/env.js'
import { logger } from '../core/logger.js'

let readerPromise: Promise<Reader<CityResponse>> | null = null
let warnedAboutDatabase = false

export async function approximateIpGeolocation(ip: string | undefined): Promise<string | null> {
  if (!env.GEOIP_DATABASE_PATH || !ip || !validate(ip)) return null

  try {
    readerPromise ??= open<CityResponse>(env.GEOIP_DATABASE_PATH)
    const reader = await readerPromise
    const result = reader.get(ip)
    if (!result?.country?.iso_code) return null

    return JSON.stringify({
      country: result.country.iso_code,
      ...(result.subdivisions?.[0]?.iso_code ? { region: result.subdivisions[0].iso_code } : {}),
    })
  } catch (error) {
    if (!warnedAboutDatabase) {
      warnedAboutDatabase = true
      logger.warn({ err: error }, 'Offline GeoIP database is unavailable; recording no IP location')
    }
    return null
  }
}
