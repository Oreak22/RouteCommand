# Performance evidence and remaining measurements

This guide separates existing project evidence from measurements that have not yet been collected. Phase 19 performance/reliability verification remains open.

## Implemented performance paths

- Redis is the telemetry hot path for current positions, heartbeats, GEO lookup, and stream buffering; accepted batches are persisted to PostGIS asynchronously in multi-row transactions.
- PostGIS spatial indexes support zone containment, radius search, and nearest-driver queries. Planner evidence and seed-size caveats are recorded in [SPATIAL_QUERIES.md](SPATIAL_QUERIES.md).
- Socket.IO distributes authorized position updates; browser map updates are coalesced and driver markers use an imperative layer. Large visible fleets use canvas drawing/clustering.
- `/map?benchmark=200` in a development build emits 200 synthetic position updates per second for visual map inspection. This is not an API throughput benchmark.
- The user reported integration coverage for 10,000-point ingestion and deduplication in Phases 8–9. Treat it as functional evidence, not a repeatable production capacity result.

## Current browser evidence

During Phase 12 review the FPS overlay showed 55.8 FPS at one point and later dipped to 45 FPS. The user asked to restore the earlier marker visuals and raise the target to 55 FPS, then confirmed the restored visual/performance checks were satisfactory. Exact device model, browser build, viewport, fleet count, run duration, thermal/power state, and sustained FPS distribution were not recorded. Do not cite a sustained 55 FPS guarantee from that review.

## Reproducing the map check

1. Start the local stack and seed demo data.
2. Open `/map?benchmark=200` in a development build, use the browser's FPS/GPU overlay, and record the browser and device details.
3. Record fleet size, viewport and zoom, duration, median and low-percentile FPS, CPU/GPU, memory, and whether map tiles are warm or cold.
4. Repeat with the normal live map and representative location updates. Keep the visual settings that the user approved; do not silently trade away marker clarity to hit a target.

## Phase 19 work still needed

- Repeatable browser benchmark with exact device and browser details, sustained frame-time distribution, and React Profiler capture.
- API/load measurements for telemetry throughput, socket fan-out, route requests, database pool saturation, and response latency under representative fleet sizes.
- CPU/RSS and Redis/PostgreSQL resource tracking; establish limits and expected recovery behavior.
- Database/Redis/network failure and worker-restart drills, queue backlog/reclaim evidence, and alerting thresholds.
- Document workload, environment, tool versions, sample size, warm-up and raw results so the findings can be repeated.
