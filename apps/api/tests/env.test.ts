import { describe, expect, it } from 'vitest'

import { InvalidEnvironmentConfigurationError, parseEnvironment } from '../src/config/env.js'

describe('parseEnvironment', () => {
  it('provides typed development defaults and parses the CORS allow-list', () => {
    const environment = parseEnvironment({
      CORS_ORIGINS: 'https://dispatch.routecommand.test, http://localhost:5173',
    })

    expect(environment.NODE_ENV).toBe('development')
    expect(environment.JWT_ACCESS_TTL_SECONDS).toBe(900)
    expect(environment.CORS_ORIGINS).toEqual([
      'https://dispatch.routecommand.test',
      'http://localhost:5173',
    ])
  })

  it('rejects the built-in development signing keys in production', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow(
      InvalidEnvironmentConfigurationError,
    )
  })

  it('rejects invalid proxy and CORS settings', () => {
    expect(() => parseEnvironment({ TRUST_PROXY_HOPS: '11' })).toThrow(
      InvalidEnvironmentConfigurationError,
    )
    expect(() => parseEnvironment({ CORS_ORIGINS: 'not a URL' })).toThrow(
      InvalidEnvironmentConfigurationError,
    )
  })

  it('uses WEB_ORIGIN as the default CORS allow-list entry', () => {
    const environment = parseEnvironment({ WEB_ORIGIN: 'https://dispatch.routecommand.test' })

    expect(environment.CORS_ORIGINS).toEqual(['https://dispatch.routecommand.test'])
  })

  it('configures pickup proximity defaults and accepts a strict enforcement mode', () => {
    const defaults = parseEnvironment({})
    const strict = parseEnvironment({
      PICKUP_PROXIMITY_RADIUS_M: '250',
      PICKUP_PROXIMITY_MODE: 'STRICT',
    })

    expect(defaults.PICKUP_PROXIMITY_RADIUS_M).toBe(150)
    expect(defaults.PICKUP_PROXIMITY_MODE).toBe('SOFT')
    expect(strict.PICKUP_PROXIMITY_RADIUS_M).toBe(250)
    expect(strict.PICKUP_PROXIMITY_MODE).toBe('STRICT')
    expect(() => parseEnvironment({ PICKUP_PROXIMITY_MODE: 'MAYBE' })).toThrow(
      InvalidEnvironmentConfigurationError,
    )
  })
})
