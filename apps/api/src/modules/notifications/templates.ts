import type { ShipmentStatusEmailData } from './shipment-status.js'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]!
  })
}

export function renderShipmentStatusEmail(
  status: 'PICKED_UP' | 'IN_TRANSIT' | 'ARRIVED',
  shipment: ShipmentStatusEmailData,
  trackingUrl: string,
): { subject: string; text: string; html: string; template: string } {
  const firstName = shipment.customerName.trim().split(/\s+/)[0] || 'there'
  const trackingCode = shipment.trackingCode
  const detail =
    status === 'PICKED_UP'
      ? `Your package has been picked up${shipment.driverName ? ` by ${shipment.driverName.split(/\s+/)[0]}` : ''}${shipment.vehicleType ? ` in a ${shipment.vehicleType.toLowerCase()}` : ''}.`
      : status === 'IN_TRANSIT'
        ? `Your package is on its way${shipment.eta ? `. Current estimated arrival: ${shipment.eta.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC.` : '.'}`
        : `Your package has arrived at ${shipment.dropoffAddress}.`
  const subject =
    status === 'PICKED_UP'
      ? 'Your package has been picked up'
      : status === 'IN_TRANSIT'
        ? 'Your package is on its way'
        : 'Your package has arrived'
  const content = renderNotice({
    subject,
    greeting: firstName,
    lines: [detail, `Tracking code: ${trackingCode}`],
    actionLabel: 'Track package',
    actionUrl: trackingUrl,
    footer: 'RouteCommand delivery updates',
  })
  return { ...content, template: `shipment_${status.toLowerCase()}` }
}

export function renderNotice(input: {
  subject: string
  greeting: string
  lines: string[]
  actionLabel: string
  actionUrl: string
  footer?: string
}): { subject: string; text: string; html: string } {
  const text = `Hello ${input.greeting},\n\n${input.lines.join('\n')}\n${input.actionLabel}: ${input.actionUrl}\n\n${input.footer ?? 'RouteCommand'}`
  const html = `<main style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17242d"><h1 style="font-size:22px">${escapeHtml(input.subject)}</h1><p>Hello ${escapeHtml(input.greeting)},</p>${input.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}<p><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:12px 18px;background:#087e8b;color:white;text-decoration:none;border-radius:6px">${escapeHtml(input.actionLabel)}</a></p><p style="font-size:12px;color:#52616b">${escapeHtml(input.footer ?? 'RouteCommand')}</p></main>`
  return { subject: input.subject, text, html }
}
