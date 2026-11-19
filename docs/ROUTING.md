# Routing provider

RouteCommand delegates road routing and GPS trace matching to Valhalla. API and browser code use the normalized contracts in `packages/shared/src/navigation.ts`; provider JSON stays inside the adapter.

## Local service

The Compose override configures the API with `VALHALLA_URL=http://valhalla:8002`. The Valhalla service must have a local OSM tile extract mounted at `/custom_files`; tile data is local-only and must not be committed. The routing engine is private to the Compose network. Set `VALHALLA_URL` to the internal service address for another deployment.

Configuration is validated by the API environment schema:

- `VALHALLA_URL`: base URL, defaulting to `http://valhalla:8002` in local Compose.
- `VALHALLA_TIMEOUT_MS`: upstream request timeout.
- `NAVIGATION_REROUTE_MIN_INTERVAL_SECONDS`: per-session reroute throttle.
- `NAVIGATION_PROGRESS_MIN_INTERVAL_SECONDS`: per-session progress throttle.

The adapter supports `auto`, `bicycle`, and `truck` costing. Driver vehicle type selects the cost model when starting and rerouting a session. Routes are cached in memory for 30 seconds by request; upstream requests have a timeout and a short circuit-open interval after repeated failures. The cache and circuit state are process-local.

Active `RESTRICTED` zone polygons are sent as route exclusions when their combined perimeter is under 9 km. Valhalla rejects exclusion sets above its 10 km circumference limit; for larger sets, the service calculates a road route without provider exclusions and checks the resulting route against active restricted polygons using PostGIS. If an exclusion request is rejected, the service retries without exclusions and performs the same PostGIS check. Navigation start/reroute is blocked when a route crosses a restricted zone. A dispatcher route preview reports the crossing so operations can review it. If the engine is unavailable, the API returns a clearly marked straight-line fallback and checks that fallback against restricted zones as well.

## Limitations

- Routing uses the OSM extract currently loaded in Valhalla. Coverage and road freshness depend on that extract.
- No live traffic, closures, or incident data are supplied. Route duration is an estimate.
- Straight-line degraded guidance is only a bearing/distance aid; it is not a road route.
- `FakeProvider` is a deterministic fixture adapter for tests/development. It is not selected by production configuration.
- `ValhallaProvider.matchTrace` exposes map matching for future route replay/analysis; live navigation progress currently uses the shared client-side route projection engine.

See [NAVIGATION.md](NAVIGATION.md) for the session API and driver behavior.
