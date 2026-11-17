const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const token = process.env.TELEMETRY_TOKEN
const countArg = process.argv.find((argument) => argument.startsWith('--count='))
const count = Number(countArg?.slice('--count='.length) ?? 1_000)

if (!token)
  throw new Error('Set TELEMETRY_TOKEN to a driver access token before running the simulator.')
if (!Number.isInteger(count) || count < 1 || count > 100_000) {
  throw new Error('--count must be an integer between 1 and 100000.')
}

const center = { lat: 6.5244, lng: 3.3792 }
const metersPerLatitudeDegree = 111_320
const startTime = Date.now() - Math.max(0, count - 1) * 1_000
let accepted = 0
let filtered = 0

for (let offset = 0; offset < count; offset += 500) {
  const points = Array.from({ length: Math.min(500, count - offset) }, (_, index) => {
    const sequence = offset + index
    const angle = sequence / 25
    const distance = sequence * 2
    const lat = center.lat + (Math.cos(angle) * distance) / metersPerLatitudeDegree
    const lng =
      center.lng +
      (Math.sin(angle) * distance) /
        (metersPerLatitudeDegree * Math.cos((center.lat * Math.PI) / 180))
    return {
      lat,
      lng,
      accuracyM: 6,
      speedMps: 2,
      headingDeg: ((angle * 180) / Math.PI + 360) % 360,
      recordedAt: new Date(startTime + sequence * 1_000).toISOString(),
    }
  })
  let response
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(`${apiUrl}/api/v1/telemetry/batch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ points }),
    })
    if (response.status !== 429) break
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)))
  }
  if (!response?.ok) {
    throw new Error(
      `Telemetry batch failed with HTTP ${response?.status ?? 'no response'}: ${await response?.text()}`,
    )
  }
  const result = await response.json()
  accepted += result.data.queued
  filtered += result.data.filtered
  process.stdout.write(`\rQueued ${accepted}/${count} fixes; filtered ${filtered}`)
}
process.stdout.write('\n')
