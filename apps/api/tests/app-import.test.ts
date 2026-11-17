import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'

describe('API module initialization', () => {
  it('loads the application module graph without an ESM initialization cycle', () => {
    expect(typeof createApp).toBe('function')
  })
})
