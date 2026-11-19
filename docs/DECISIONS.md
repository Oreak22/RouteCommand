# Architecture Decision Records

## ADR-001: Establish an npm workspace monorepo — 2026-11-14

**Status:** Accepted

**Context:** The project needs separate web and API applications while sharing domain types and validation contracts. The existing Vite and Express starters lived in `client/` and `server/`, outside the structure specified by the project plan.

**Decision:** Use npm workspaces with `apps/web`, `apps/api`, and `packages/shared`. Keep the existing starter source under the new application paths and make the shared package the common TypeScript boundary.

**Consequences:** Root scripts and lockfile govern the workspace. The starter applications can evolve independently while consuming shared package exports.

## ADR-002: Keep the lint toolchain on ESLint 9 for plugin compatibility — 2026-11-14

**Status:** Accepted; revisit when both lint plugins support ESLint 10.

**Context:** The project requires JSX accessibility rules and import ordering. The selected `eslint-plugin-jsx-a11y` and `eslint-plugin-import` releases declare peer support through ESLint 9, while the environment's current ESLint release is 10. npm rejects that combination during a clean install. The JSX accessibility plugin is tracking ESLint 10 support upstream: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/issues/1075.

**Decision:** Use the latest ESLint 9 release with those plugins so clean installs and lint runs use a supported peer combination. Keep the flat ESLint config and upgrade ESLint and any plugin versions together once the required plugins publish ESLint 10 support.

**Consequences:** npm currently warns that ESLint 9 is outside its support window. This affects development tooling only; the explicit accessibility and import-order rules remain active. Revisit this decision during Phase 20 or when upstream support is released.

## ADR-003: Close Phase 1 with Lighthouse audit deferred — 2026-11-14

**Status:** Accepted

**Context:** Phase 1 implementation, component tests, responsive layout checks, and production verification are complete. Lighthouse could not be fetched because `registry.npmjs.org` did not resolve in the environment. The Phase 1 plan requires an accessibility score of at least 90.

**Decision:** At the user's direction, close Phase 1 and begin Phase 2 with the Lighthouse score explicitly deferred. Keep the ≥90 target and rerun the audit when npm registry access is available, no later than the Phase 20 verification pass.

**Alternatives considered:** Keep Phase 1 open until the npm registry becomes available.

**Consequences:** Phase 1 is considered closed by user-approved exception. The missing Lighthouse score remains a documented verification gap and must not be reported as achieved.

## ADR-004: Use the planned auth crypto and SMTP queue stack — 2026-11-15

**Status:** Accepted

**Context:** Phase 4 requires Argon2id password hashes, signed short-lived JWTs, opaque rotating refresh tokens, and queued verification/reset email through SMTP. The locked stack names `argon2`, JWT, BullMQ, and Nodemailer.

**Decision:** Use `argon2` for Argon2id hashing, `jose` for JWT signing/verification with an explicit HS256 allow-list, BullMQ with a dedicated `ioredis` connection for durable email jobs, and Nodemailer for SMTP delivery. Use Mailpit in development and integration tests.

**Consequences:** Access tokens stay in browser memory; refresh tokens are random, hashed in PostgreSQL, rotated by family, and held in a scoped httpOnly cookie. Action tokens are stored as hashes and emailed with fragments so they are not sent in HTTP requests. Real inbox delivery and DNS authentication remain Phase 11A verification work.

## ADR-005: Keep operational zones as validated MultiPolygons — 2026-11-16

**Status:** Accepted

**Context:** Zones need topology validation, spatial indexing, holes, and circle drawing support while the existing schema stores `geography(MultiPolygon, 4326)`.

**Decision:** Accept Polygon and MultiPolygon GeoJSON, validate closed rings and coordinates at the shared contract boundary, then use PostGIS `ST_IsValid` and geography area checks before saving. Cap a zone at 5,000 vertices and 50,000 km². Convert drawn circles into 64-vertex geodesic polygons. Keep the original geometry in PostGIS and use topology-preserving simplification only for low-zoom map responses. Serve the Valhalla graph from a local Nigeria OSM extract because the demo area is Lagos.

**Consequences:** Circles are stored as polygon approximations and may not preserve an exact radius. The browser provides immediate checks for straightforward ring crossings; PostGIS remains authoritative for topology. OSM routing data and generated Valhalla tiles are local-only and must not be committed. Geofencing overlap precedence and hysteresis remain Phase 10 concerns.

## ADR-006: Use transactional shipment transitions with bounded operational defaults — 2026-11-17

**Status:** Accepted

**Context:** Phase 7 requires an auditable shipment lifecycle, retry-safe transitions, and a pickup-distance rule without depending on Phase 8 telemetry ingestion or Phase 14A routing.

**Decision:** Keep the shipment transition table in one API state-machine module. Customers may cancel their own requests only before pickup; dispatchers and administrators may cancel any non-terminal shipment. Customer address entry includes map-picked coordinates. Estimate initial ETA using a Haversine distance divided by an 8 m/s urban average behind an `EtaEstimator` interface. Pickup proximity defaults to a 150 m radius in `SOFT` mode and records a warning when the latest driver location is missing, stale, inaccurate, or outside the radius; `STRICT` mode rejects the transition. Persist optional transition idempotency keys and their original response per shipment. Expose only minimal customer identity choices to dispatchers through a shipment-scoped endpoint.

**Alternatives considered:** Make pickup distance a hard block by default; compute initial ETA through Valhalla immediately; allow users to assign a driver through an unvalidated free-form ID.

**Consequences:** ETA is a rough straight-line estimate until Phase 14A replaces it with road-route ETAs. The soft pickup default supports development before live telemetry is available; deployments can require strict proximity through environment configuration. Transition key records are retained with the shipment history.

## ADR-007: Buffer telemetry in Redis Streams — 2026-11-17

**Status:** Accepted

**Context:** Phase 8 requires PostgreSQL history writes to be batched and kept off the telemetry ingestion hot path, while protecting fixes from process restarts.

**Decision:** Append validated telemetry points to a Redis Stream and persist them through a consumer group in bounded multi-row batches. Acknowledge stream entries only after the database transaction commits; replay is safe through a unique `(driver_id, recorded_at)` constraint. Use Redis for the latest-position hash, GEO index, heartbeat TTL, and live telemetry pub/sub. The API process initially hosts the consumer loop; the stream/consumer-group contract allows moving the worker to a separate process later without changing ingestion.

**Alternatives considered:** An in-memory batch (simpler but loses buffered fixes on process crash); synchronous database writes (violates hot-path requirement); a new queue library (duplicates Redis Streams already available in the locked stack).

**Consequences:** Redis persistence and availability are part of telemetry durability. Consumer failure leaves unacknowledged work for retry; duplicate delivery is expected and deduplicated by PostgreSQL. Successfully persisted entries are acknowledged and deleted immediately; pending entries remain available for reclaim. Redis persistence and backups are required if buffered points must survive host loss.

## ADR-008: Put driver context in short-lived signed access-token claims — 2026-11-17

**Status:** Accepted

**Context:** Telemetry identity and vehicle-specific speed limits must be derived from trusted server state without a synchronous PostgreSQL driver lookup on every telemetry batch.

**Decision:** Add optional `driverId` and `vehicleType` claims to access tokens issued for drivers. Resolve both from PostgreSQL when the token is issued or refreshed, validate their shape with the signed token, and attach them to the authenticated request context. Telemetry endpoints require this server-issued context and never accept driver identity or vehicle type from the request body.

**Alternatives considered:** Accepting driver identity in the telemetry payload (untrusted); querying PostgreSQL for the driver on each batch (adds synchronous DB work to ingestion); using one global speed limit (less accurate across vehicle classes).

**Consequences:** Vehicle assignment changes are reflected after the driver's next access-token refresh; access tokens remain short-lived. A DRIVER account without a provisioned driver profile cannot ingest telemetry.

## ADR-009: Use Socket.IO with a Redis adapter and elected realtime broadcaster — 2026-11-17

**Status:** Accepted

**Context:** Phase 9 needs authenticated bidirectional telemetry, room-scoped operational events, Redis-backed horizontal fan-out, and coalesced driver position updates. Each API instance can observe the same Redis pub/sub message, so allowing every instance to broadcast would duplicate events through the Socket.IO Redis adapter.

**Decision:** Attach Socket.IO to the API HTTP server and use the Socket.IO Redis adapter for room broadcasts. Bridge committed domain events and accepted live telemetry through Redis. Elect one short-lease Redis broadcaster for each deployment to translate those shared events into Socket.IO events; issue monotonic per-driver sequence numbers in Redis. Validate user and session identity at handshake and refresh, limit connections and subscriptions per user/socket, and authorize shipment room joins through the shipment service.

**Alternatives considered:** Run one socket-only process (adds a deployment unit); let every API instance broadcast (duplicates adapter fan-out); use raw WebSockets (duplicates room, reconnect, and polling-fallback work).

**Consequences:** Socket fan-out continues across API instances while only one translates shared events at a time. During broadcaster failover a position delta may be delayed until the next telemetry update; reconnect snapshots provide recovery. Redis pub/sub remains ephemeral and is not an event-history store.

## ADR-010: Use PostGIS for geofence membership and persistent two-fix hysteresis — 2026-11-17

**Status:** Accepted

**Context:** Zone edits and overlaps must produce deterministic enter/exit events, including across API restarts, while GPS jitter at boundaries must not create alert flapping. Redis is available for fast telemetry but zone membership is business state that needs durable transitions.

**Decision:** Query active zone membership with indexed PostGIS `ST_Covers` for each accepted live fix. Keep current and pending membership in `geofence_states`; require two consecutive fixes with the changed membership before committing an enter/exit. Serialize updates per driver with a transaction-scoped PostgreSQL advisory lock. Treat a driver's first observed point as a baseline, so starting inside a zone does not create an ENTER alert.

**Alternatives considered:** Use an in-process polygon library (duplicates PostGIS semantics and cache invalidation); keep geofence state only in Redis (state is lost on eviction/restart); emit on every point crossing (boundary jitter creates duplicate alerts).

**Consequences:** Every qualifying live fix performs a small indexed PostGIS query and state transaction. The second confirming fix must arrive before a transition alert is emitted. Replayed telemetry can update pending state, but serialized durable membership and the active-alert unique index prevent duplicate alert creation.

## ADR-011: Rank dispatch suggestions with distance, freshness, workload, and zone match — 2026-11-18

**Status:** Accepted

**Context:** Phase 11 needs deterministic driver suggestions while rejecting drivers whose location, capacity, status, or active workload makes an assignment unsafe.

**Decision:** Use indexed PostGIS `ST_DWithin` to filter available drivers by a configurable pickup radius, require an active vehicle with enough capacity and a recent accurate fix, and exclude unresolved `SIGNAL_LOST` alerts and drivers with active shipments. Rank the remaining candidates using pickup distance, freshness, active workload, and a same-delivery-zone preference. Revalidate availability and capacity under row locks during assignment.

**Consequences:** Suggestions are advisory and can go stale; assignment always rechecks every constraint transactionally. The radius and score weights are named environment settings with documented defaults.

## ADR-012: Use a rounded, separately rate-limited public tracking projection — 2026-11-18

**Status:** Accepted

**Context:** Phase 13 exposes delivery progress to anyone with a random tracking code. The existing authenticated realtime gateway cannot serve a public tracking page, and reusing its unrestricted driver position payload would expose unnecessary identity and location precision.

**Decision:** Return a fixed-shape public tracking response with status-only event history, no customer or driver identifiers, first name and vehicle type at most, no public dropoff address, and driver/destination coordinates rounded to three decimal places. Include driver coordinates only in `PICKED_UP`, `IN_TRANSIT`, or `ARRIVED`; hide fixes older than 30 minutes. Use a separate anonymous `/tracking` Socket.IO namespace with Redis-backed IP limits; keep HTTP polling as recovery. Give the owning authenticated customer a separate route for exact delivery address and precise coordinates.

**Alternatives considered:** Expose shipment details through existing authenticated shipment endpoints (fails for public recipients); broadcast the operational driver position event (exposes exact coordinates and operational fields); persist a separate tracking snapshot table (duplicates existing shipment and telemetry data).

**Consequences:** Public tracking links remain bearer credentials and must be shared carefully. Public updates have no customer identity, exact driver coordinate, or destination address. Anonymous socket and HTTP traffic is rate limited; public data is not cached.

## ADR-013: Keep driver zone visibility read-only — 2026-11-18

**Status:** Accepted

**Context:** The Phase 14 driver map needs active operating zones so drivers can understand their work area. The existing zone API is also the editing surface used by dispatchers and administrators.

**Decision:** Allow authenticated DRIVER accounts to read active zone lists, zone details, and simplified GeoJSON. Keep point checks, creation, edits, and deactivation restricted to ADMIN and DISPATCHER.

**Consequences:** The driver map can render zone context without exposing zone-management actions. Future zone-related driver behavior must continue to enforce these role boundaries on the API.

## ADR-014: Restrict navigation geometry to drivers and operations — 2026-11-18

**Status:** Accepted

**Context:** Shipment realtime rooms can be joined by the owning customer. Broadcasting a full planned/rerouted path to that room would expose operational route geometry beyond what the customer tracking view is designed to show.

**Decision:** Emit navigation route and progress events only to the assigned driver's room and the operations room. Send customers ETA updates through the existing privacy-limited tracking projection instead of the authenticated shipment room.

**Consequences:** Customers can follow shipment status and ETA but do not receive navigation internals or the driver's planned path. Dispatchers retain route and progress on the live operations map.

## ADR-015: Prepare interview documentation before closing intervening phases — 2026-11-19

**Status:** Accepted

**Context:** The user has an interview presentation and limited preparation time. Phases 14–20 remain open, while substantial implemented work and its status are already available in the repository.

**Decision:** Start Phase 21 documentation early. Explain current architecture, packages, mapping, data flow, demo order, and known gaps using the current code and user-reported evidence. Preserve the open status of phases 14–20 and keep Phase 21 open until the remaining screenshots/video and timed clean-clone demo are completed.

**Consequences:** The interview guide can be used now without implying unfinished verification has passed. The project plan's phase order is intentionally interrupted at the user's direction and should resume with the open phases later.
