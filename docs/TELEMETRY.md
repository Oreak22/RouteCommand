# Telemetry ingestion

## Point contract

The shared `telemetryPointSchema` accepts a WGS84 fix with `lat` and `lng` in decimal degrees, required horizontal `accuracyM` in metres, and an offset-bearing ISO `recordedAt` device timestamp. `altitudeM`, `speedMps`, `headingDeg`, and `batteryPct` are optional. Coordinates must be finite and in range; exact `(0, 0)` is rejected. Heading is in `[0, 360)`, and speed and accuracy cannot be negative. A batch contains 1–500 fixes and the HTTP body limit also applies.

Vehicle speed limits and accuracy thresholds come from API environment settings. Fixes above `MAX_ACCURACY_M`, with implausible speed, impossible implied movement, stale device time, stationary GPS jitter, or an out-of-order timestamp are kept in history as filtered points with their `filter_reasons` and do not move the live marker. Timestamps beyond the configured future skew or maximum offline age are rejected. Both device `recorded_at` and server `received_at` are stored so device clock skew does not determine signal freshness.

Driver identity and vehicle type come from signed access-token claims issued by the auth service. The request body cannot choose a driver. `POST /api/v1/telemetry/batch` returns HTTP 202 after Redis has accepted the points; it does not mean PostgreSQL history has already committed.

## Pipeline and delivery

The API validates each batch, applies a per-driver Redis rate limit, then appends each fix to `routecommand:telemetry:stream`. A Lua operation atomically checks the current Redis position, appends the history entry, refreshes the heartbeat, and updates the location hash/GEO index only for a newer live-eligible point. Live-eligible fixes are published to `routecommand:telemetry:live` for the Phase 9 gateway. PostgreSQL is not called on the ingestion request path.

The API-hosted Redis Streams consumer group reads up to 500 entries at a time and writes each group in one transaction with a multi-row `INSERT`. It acknowledges and deletes stream entries only after commit. If the database write fails, entries remain pending for retry/reclaim. `(driver_id, recorded_at)` is unique and inserts use `ON CONFLICT DO NOTHING`, making replay safe. A Redis Stream entry that cannot pass the persisted contract is logged and discarded to prevent one poison entry blocking the group. Run Redis with persistence and a durable volume anywhere telemetry must survive Redis host loss; Redis Streams do not replace backups.

The worker updates `drivers.last_known_location` and `last_seen_at` at most once per configured throttle window per driver. A periodic sweep creates one open `SIGNAL_LOST` alert when an active driver's stored heartbeat exceeds `DRIVER_SIGNAL_STALE_SECONDS`, removes stale drivers from the Redis GEO index, and resolves an open signal alert on the next received fix. Alert presentation and lifecycle APIs belong to Phase 10.

## History and operations

- `GET /api/v1/telemetry/drivers/:driverId/track?from=&to=&simplifyM=` returns a GeoJSON Feature with a LineString and point count, distance, duration, average/max speed, and time bounds. It includes filtered raw fixes so an operator can inspect poor-quality input.
- `GET /api/v1/telemetry/drivers/:driverId/points?limit=&cursor=` returns newest-first raw fixes. The opaque cursor is an encoded timestamp; timestamps are unique per driver by the ingestion constraint.
- ADMIN and DISPATCHER can request any driver's history. A DRIVER can request only their own. Unknown drivers return 404.
- `GET /metrics` requires an ADMIN access token and reports process counters for accepted, filtered, and rejected input; average request latency; Redis stream depth; and average batch flush duration/point count. Counters reset when the API process restarts.

The simulator sends realistic bounded batches to the authenticated HTTP fallback. Set `TELEMETRY_TOKEN` to a driver access token; `API_URL` defaults to `http://localhost:3000`. Example: `TELEMETRY_TOKEN=... npm run sim -- --count=10000`. Its generated timestamps span the simulated trip duration. The maximum is 100,000 fixes per run; use a disposable environment for large runs.

## Driver device capture and offline delivery

The driver app starts browser geolocation only after the driver taps **Start sharing** while their availability is `AVAILABLE` or `BUSY`. Capture is owned by the driver layout, so it continues when the driver moves between Jobs, Shipments, Map, and Profile, and stops when the driver goes offline or on break. It requests high accuracy, accepts a moving fix after at least 2 seconds and 5 metres, and sends a 15-second stationary heartbeat. When the browser exposes battery state, low battery while unplugged lowers sampling frequency. The app displays actual browser-reported horizontal accuracy (good ≤30 m, fair ≤100 m, poor >100 m); browsers do not expose a reliable satellite count.

Fixes are stored in the browser's native IndexedDB before they are sent. Up to 10,000 are retained; when the limit is reached the oldest 10% window is downsampled by retaining alternating fixes. The driver app sends chronological batches of at most 500 over authenticated Socket.IO, falling back to `POST /api/v1/telemetry/batch` when the socket is disconnected or a realtime send fails. Failed sync retries use exponential backoff up to five minutes, and the driver sees the pending count. Device timestamps are made monotonic per local capture session to avoid collisions, and the existing database uniqueness on `(driver_id, recorded_at)` makes replay safe.

Offline driver status transitions use the same IndexedDB database and the shipment transition endpoint's idempotency key. They replay in order after connectivity returns. A 4xx response is retained as a failed action for driver review instead of being retried indefinitely. These browser flows and offline recovery still need manual verification as part of Phase 14.

The driver PWA caches the app shell, same-origin build assets, and a bounded number of map tiles; it does not cache authenticated API responses. Background GPS is not reliable in browsers, so keep the driver app open during a shift. Where Background Sync is supported, queued records can upload after the page closes: the service worker refreshes the existing session cookie, obtains a short-lived access token under the cross-tab refresh lock, and only processes records belonging to that authenticated driver. This is best-effort; on unsupported browsers, queued data syncs when the app is reopened with a connection.

To review installability and offline shell caching, build and serve the production web app over localhost or HTTPS; the Compose/Vite development server does not register the production service worker. Chromium-based browsers show an install prompt when eligible. On iOS, use Safari's Share menu and choose **Add to Home Screen**. The app reports stale GPS fixes after 45 seconds and provides an in-app explanation when a location permission is denied.

Retention and partition deletion/downsampling are intentionally deferred to Phase 14's retention-job hook. Socket.IO becomes the primary ingestion channel in Phase 9; HTTP remains the offline-sync fallback.

## Integration verification

The normal `npm run test:integration` path creates disposable Testcontainers. If the local Docker daemon is unavailable to Testcontainers, the harness can use explicitly supplied external services. Create a disposable PostGIS database whose name ends with `_check` or `_test`, use Redis database 15 (the harness clears it), and point SMTP at Mailpit, then run:

```sh
INTEGRATION_ALLOW_RESET=true \
TEST_DATABASE_URL='postgres://routecommand:routecommand@localhost:5432/routecommand_phase8_check' \
TEST_REDIS_URL='redis://localhost:6379/15' \
TEST_SMTP_HOST=localhost TEST_SMTP_PORT=1025 \
npm run test:integration
```

The harness truncates tables in the named database and clears Redis DB 15. Never point these variables at an application database or a Redis database containing non-test data.
