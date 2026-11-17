import { redisClient } from '../../infra/redis.js'

const counters = {
  accepted: 0,
  filtered: 0,
  rejected: 0,
  ingestionLatencyMs: 0,
  ingestionBatches: 0,
  flushDurationMs: 0,
  flushBatches: 0,
  flushedPoints: 0,
}

export function recordIngestionMetrics(input: {
  accepted: number
  filtered: number
  rejected?: number
  latencyMs: number
}): void {
  counters.accepted += input.accepted
  counters.filtered += input.filtered
  counters.rejected += input.rejected ?? 0
  counters.ingestionLatencyMs += input.latencyMs
  counters.ingestionBatches += 1
}

export function recordFlushMetrics(points: number, durationMs: number): void {
  counters.flushBatches += 1
  counters.flushedPoints += points
  counters.flushDurationMs += durationMs
}

export async function renderTelemetryMetrics(): Promise<string> {
  let bufferDepth = 0
  try {
    bufferDepth = Number(await redisClient.sendCommand(['XLEN', 'routecommand:telemetry:stream']))
  } catch {
    // The endpoint still reports process counters when Redis is unavailable.
  }
  const averageIngestionLatency = counters.ingestionBatches
    ? counters.ingestionLatencyMs / counters.ingestionBatches
    : 0
  const averageFlushDuration = counters.flushBatches
    ? counters.flushDurationMs / counters.flushBatches
    : 0
  return [
    '# HELP routecommand_telemetry_points_total Telemetry points accepted by the API.',
    '# TYPE routecommand_telemetry_points_total counter',
    `routecommand_telemetry_points_total{result="accepted"} ${counters.accepted}`,
    `routecommand_telemetry_points_total{result="filtered"} ${counters.filtered}`,
    `routecommand_telemetry_points_total{result="rejected"} ${counters.rejected}`,
    '# TYPE routecommand_telemetry_ingestion_latency_ms_avg gauge',
    `routecommand_telemetry_ingestion_latency_ms_avg ${averageIngestionLatency.toFixed(3)}`,
    '# TYPE routecommand_telemetry_buffer_depth gauge',
    `routecommand_telemetry_buffer_depth ${bufferDepth}`,
    '# TYPE routecommand_telemetry_flush_duration_ms_avg gauge',
    `routecommand_telemetry_flush_duration_ms_avg ${averageFlushDuration.toFixed(3)}`,
    '# TYPE routecommand_telemetry_flush_points_total counter',
    `routecommand_telemetry_flush_points_total ${counters.flushedPoints}`,
    '# TYPE routecommand_telemetry_flush_batches_total counter',
    `routecommand_telemetry_flush_batches_total ${counters.flushBatches}`,
    '',
  ].join('\n')
}
