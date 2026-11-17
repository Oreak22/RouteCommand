import { describe, expect, it } from 'vitest'

import { renderActionEmail } from '../src/infra/email-queue.js'

describe('authentication email templates', () => {
  it('escapes user-controlled markup in the HTML body', () => {
    const rendered = renderActionEmail({
      greeting: '<img src=x onerror=alert(1)>',
      action: 'Verify & confirm',
      url: 'https://dispatch.example.test/verify#token=abc&def',
      expiresIn: '24 hours',
    })

    expect(rendered.html).not.toContain('<img')
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(rendered.html).toContain('Verify &amp; confirm')
    expect(rendered.text).toContain('<img src=x onerror=alert(1)>')
  })
})
