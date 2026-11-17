import { describe, expect, it } from 'vitest'

import {
  recordFlushMetrics,
  recordIngestionMetrics,
  renderTelemetryMetrics,
} from '../src/modules/telemetry/metrics.js'

describe('telemetry metrics', () => {
  it('reports ingestion, buffering, batching, and latency metrics in Prometheus format', async () => {
    recordIngestionMetrics({ accepted: 8, filtered: 2, rejected: 1, latencyMs: 12 })
    recordFlushMetrics(8, 5)

    const metrics = await renderTelemetryMetrics()
    expect(metrics).toContain('routecommand_telemetry_points_total{result="accepted"} 8')
    expect(metrics).toContain('routecommand_telemetry_points_total{result="filtered"} 2')
    expect(metrics).toContain('routecommand_telemetry_points_total{result="rejected"} 1')
    expect(metrics).toContain('routecommand_telemetry_ingestion_latency_ms_avg 12.000')
    expect(metrics).toContain('routecommand_telemetry_flush_duration_ms_avg 5.000')
    expect(metrics).toContain('routecommand_telemetry_flush_points_total 8')
    expect(metrics).toContain('routecommand_telemetry_flush_batches_total 1')
  })
})
