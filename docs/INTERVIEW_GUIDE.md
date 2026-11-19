# RouteCommand interview walkthrough

Use this as a rehearsal guide, not a script to recite word for word. Lead with the user problem, explain the data flow with one map example, then show the screens. Be precise about what you personally built and what still needs verification.

## 30-second introduction

> “RouteCommand is a logistics operations platform I built to connect dispatch, fleet visibility, shipment tracking, and driver navigation. The central engineering problem is turning noisy driver GPS into useful, permission-aware map updates without making the database or browser do all the work. I use Redis for the live location and buffering path, PostGIS for durable spatial queries and zone checks, and Socket.IO to update operations maps. The app also covers shipment lifecycle, driver assignment, public tracking, alerts, and a Valhalla-based navigation flow.”

If asked about status, add:

> “The core workflow through tracking has been reviewed. Driver offline behavior and the newer pickup-first navigation flow are implemented but still need their planned device and integration review. Security hardening, repeatable performance measurements, and CI consolidation also remain open.”

## Two-minute project story

> “A dispatcher needs to see where drivers are, assign work, and notice operational problems. A driver needs to share location and complete pickup and delivery. A customer needs a safe view of shipment progress. Those are separate role experiences over the same shipment and location data.”

> “The map is the interface, but the hard part is the pipeline behind it. The driver app captures GPS with accuracy and time metadata. The API derives driver identity from the signed token, validates the fix, and sends it into Redis. Redis maintains the latest eligible location and buffers history in a stream. A worker persists history to PostGIS in batches. Socket.IO sends authorized live updates to the dispatcher map. PostGIS handles proximity and zone questions. For driver navigation, the API adapts Valhalla responses into a provider-independent route contract.”

> “I made a few deliberate tradeoffs: stale or inaccurate points can remain in history for investigation but do not move the live marker; a database outage can be retried from the stream; route geometry is not sent to public tracking; and map rendering switches to a canvas path for larger fleets. I still need broader security, load, device, and clean-clone verification before calling the project production-ready.”

## Suggested five-minute live demo

Use a seeded local account and confirm the containers and routing data before the interview. The full time-coded version is in [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

1. **Frame the problem (30 seconds):** show the architecture diagram and the map. Explain who uses the system.
2. **Dispatcher map (60 seconds):** select a driver, show their status/location, inspect a shipment, and point out pickup and delivery markers. If showing seeded positions, say they are seed data; do not imply they are live GPS.
3. **Spatial feature (60 seconds):** show a saved zone and its map overlay. Explain that GeoJSON boundaries are validated at the API and PostGIS is authoritative for containment and distance checks.
4. **Shipment/customer (60 seconds):** show lifecycle history and public tracking. Explain that public coordinates are rounded and the page does not expose the operational route.
5. **Engineering proof (60 seconds):** open API docs and the recorded spatial query evidence. Explain Redis buffering, batched database persistence, and index use without claiming a benchmark you did not run.
6. **Driver/navigation and close (60 seconds):** show the driver UI if the review state is clear. Navigation currently routes to pickup first, then changes the target to delivery after pickup confirmation. State that real-device/offline/navigation review remains pending if it has not been completed.

## How the mapping features fit together

### Browser mapping packages

- **Leaflet** is the map engine: it draws the geographic viewport, layers, markers, vectors, and tile basemaps.
- **React Leaflet** connects Leaflet layers and map lifecycle to React components. `MapCanvas` owns the map, base-layer switcher, scale, and tile providers.
- **Leaflet Draw** powers the dispatcher/admin zone editor. User-drawn polygons are converted to GeoJSON and saved through the zones API.
- `apps/web/src/features/map/` contains reusable map layers: driver markers/canvas, shipments, zones, and the map canvas. Feature-specific behavior stays in `features/zones`, `features/navigation`, and `features/tracking`.
- **TanStack Query** loads durable API data such as drivers, shipments, and zones. **Zustand** holds the latest ephemeral live positions so a GPS update does not refetch the whole page.
- **Socket.IO Client** receives authorized position and operational events. **Leaflet** renders those events; the socket library does not draw the map.

### API and data packages

- `apps/api/src/modules/telemetry/` validates driver fixes, filters live-ineligible data, writes accepted data to Redis, and persists history asynchronously.
- `apps/api/src/modules/realtime/` authenticates sockets, checks room access, and sends coalesced updates to operations screens.
- `apps/api/src/modules/zones/` owns zone CRUD and spatial checks. `apps/api/src/modules/drivers/` owns fleet and nearby-driver queries.
- **PostGIS** is PostgreSQL's spatial extension. It stores WGS84 points/polygons and answers database-side questions such as “is this point inside an active zone?” and “which eligible drivers are nearby?” with spatial indexes where the query plan supports them.
- `apps/api/src/modules/navigation/` owns navigation sessions and the routing adapter. `apps/routing/` holds the local Valhalla service/data setup. **Valhalla** calculates road routes from OpenStreetMap graph data; it is not the visual map renderer.
- `packages/shared/` contains runtime schemas and TypeScript contracts shared by web and API, including navigation and socket events. It prevents the browser and server from silently inventing different payload shapes.

### One driver location, end to end

```mermaid
sequenceDiagram
  participant Phone as Driver browser GPS
  participant API as Express API
  participant Redis
  participant Socket as Socket.IO gateway
  participant Map as React + Leaflet map
  participant PostGIS as PostgreSQL/PostGIS
  Phone->>API: lat/lng, accuracy, timestamp, optional speed/heading
  API->>API: verify driver claim; validate ranges, age, accuracy and movement
  API->>Redis: update latest eligible point and append history entry
  Redis-->>Socket: publish eligible position
  Socket-->>Map: authorized, coalesced driver position event
  Map->>Map: update marker layer and interpolate between fixes
  Redis->>PostGIS: consumer group flushes history in a batch
```

This path has two different products: the **hot current position** for fast map updates, and the **durable point history** for playback/analysis. A point can be retained as filtered history while being excluded from the hot position. API acceptance means Redis accepted the batch; it does not mean the PostGIS write has already completed.

### Coordinate conventions to explain clearly

- The project uses WGS84 coordinates (SRID 4326).
- GeoJSON positions are `[longitude, latitude]`.
- Leaflet calls are usually `[latitude, longitude]`.
- API JSON uses named `{ lat, lng }` fields.
- Geography distance operations in PostGIS use metres. Converting in one shared helper avoids the classic swapped-axis bug.

### Rendering many drivers

For smaller visible fleets, the map uses Leaflet marker layers. Position events update marker positions imperatively and interpolate between fixes so the marker appears to move smoothly without rebuilding the whole React page. At larger fleet sizes, a canvas layer draws/ clusters visible drivers and hit-tests selection. The switch is at 120 drivers in the current layer. The visual benchmark route `/map?benchmark=200` generates synthetic positions for map inspection; it is not a backend capacity test.

### Zones and spatial checks

The browser lets an operator draw/edit a zone, but the server remains authoritative. Shared contracts check coordinate structure, then the API validates geometry and PostGIS validates topology and performs spatial containment. Zone polygons are stored as geography MultiPolygons with a GiST index. Low-zoom GeoJSON may be simplified for drawing performance while the original stored geometry remains authoritative for decisions.

### Routing and navigation

Leaflet displays the route, markers, and tiles. Valhalla computes a road path. The API converts provider output into shared normalized route/leg/step contracts, checks restricted-zone crossings, and stores the driver's session/progress. The active target follows shipment status: pickup before pickup confirmation; delivery after the shipment reaches the picked-up state. The driver marker uses device position and heading, and its displayed movement is interpolated between fixes. If Valhalla is unavailable, any straight-line guidance is explicitly degraded and must not be described as a road route.

## Package tour

| Package/workspace                          | What to say                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `routecommand`                        | npm workspace scripts, lockfile, shared tooling, and commands coordinating app packages.                                                                  |
| `@routecommand/web` (`apps/web`)           | React/Vite browser app. Role-aware routes compose layouts and feature modules; mapping is Leaflet-based.                                                  |
| `@routecommand/api` (`apps/api`)           | Express service with authentication, validation, domain modules, persistence, queues, realtime, and generated OpenAPI.                                    |
| `@routecommand/shared` (`packages/shared`) | Cross-boundary TypeScript types, Zod schemas, and socket/navigation contracts. It is built before API/web type checks and tests that consume its exports. |
| Compose services                           | PostGIS database, Redis, Mailpit, and Valhalla for local integration. Map tile imagery is served by configured providers, not by PostGIS or Valhalla.     |

The package is named `@routecommand/shared`; avoid saying there is a separate npm package for each map feature. Mapping is organized as feature directories inside the web and API workspaces.

## Likely interview questions

### “Why use Redis and PostGIS? Why not store everything in PostgreSQL?”

> “The map needs a fast current position and fan-out, while history needs durable spatial queries. Redis handles hot state and buffering without making every GPS fix a synchronous database write. A consumer persists bounded batches to PostGIS. PostGIS remains the source for durable history, zones, and spatial queries. That adds operational complexity, so the stream is acknowledged only after a database commit and duplicate writes are safe.”

### “How do you keep bad GPS from moving the marker?”

> “The API trusts the authenticated driver's identity, validates coordinate ranges and timestamps, and evaluates accuracy, impossible movement, speed, and ordering. Filtered fixes can be stored with reasons, but only live-eligible fixes replace the current position.”

### “How do you prevent leaking a driver's location?”

> “The API checks role and shipment ownership. Operational socket rooms are authorized, and public tracking uses a separate limited projection with rounded and age-limited coordinates. Public customers do not receive the dispatcher event or navigation geometry.”

### “How would you scale this?”

> “The app already separates shared live state through Redis, uses the Socket.IO Redis adapter, batches history writes, and has a single elected broadcaster to avoid duplicate fan-out. Before claiming scale, I would run the open Phase 19 load and failure tests, measure connection and database pool limits, and validate Redis persistence, stream backlog recovery, and instance behavior.”

### “What did you trade off?”

> “I chose a self-hostable open routing engine and a separate tile renderer, which means I must manage OSM data and tile-provider attribution. I chose eventual history persistence through Redis Streams to keep ingestion responsive, which means Redis persistence and retry behavior matter. For large fleets, the canvas improves rendering work but makes accessible selection and hit-testing more custom.”

### “What is unfinished?”

> “Phases 14 through 20 are still open in the project record. In particular, driver offline behavior and real-device navigation need review, the 55 FPS observation lacks a reproducible device/run record, security review is not closed, and CI/test consolidation remains. Phase 21 docs are being prepared early at my request; screenshots/video and a clean-clone timed demo are still missing.”

## Claims to avoid

- Do not call the project production-ready or claim a completed security assessment.
- Do not promise sustained 55 FPS or a specific maximum fleet size from a visual test.
- Do not describe the 10,000-point integration check as a throughput benchmark.
- Do not call straight-line fallback “road navigation.”
- Do not claim that driver offline sync, phone navigation, or every notification template has passed if that review is still pending.
- Do not present seeded driver locations as live GPS.

## Before you present

- Read [the project status](PROGRESS.md) and rehearse this guide aloud once.
- Open the local app and test the exact role accounts and screens you intend to show.
- Keep the API docs and spatial query evidence ready in another tab.
- Confirm tile attribution and local Valhalla data. If routing fails, switch to the architecture explanation and call the limitation clearly.
- Use the [five-minute demo script](DEMO_SCRIPT.md) as the timed sequence.
