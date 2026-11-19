# Driver turn-by-turn navigation

Phase 14A adds a driver navigation page at `/driver/navigation`, linked from an active job. It stores an owned `navigation_sessions` record, returns a normalized Valhalla route, and resumes the active session after reload. The dispatcher map receives route and progress updates; public tracking receives only meaningful ETA updates, not route geometry. Navigation follows the shipment: the first leg targets pickup; after pickup confirmation, the active session advances to the delivery destination. Ending navigation ends that navigation session and leaves the shipment assigned to the driver.

## API

All endpoints are under `/api/v1/navigation` and require authentication. Navigation route and progress events are sent only to the assigned driver's room and operations staff. Customers receive the existing privacy-limited ETA projection through public tracking.

| Endpoint                             | Access                          | Purpose                                                       |
| ------------------------------------ | ------------------------------- | ------------------------------------------------------------- |
| `POST /routes`                       | Driver, dispatcher, admin       | Preview a route between validated coordinates                 |
| `POST /sessions`                     | Driver                          | Start a route for the driver's active assigned shipment       |
| `GET /sessions/active/me`            | Driver                          | Resume the driver's active session                            |
| `GET /sessions/active`               | Dispatcher, admin               | List active sessions for the operations map                   |
| `GET /sessions/:sessionId`           | Owner driver, dispatcher, admin | Read a session                                                |
| `POST /sessions/:sessionId/reroute`  | Driver owner                    | Reroute from a new position, throttled per session            |
| `POST /sessions/:sessionId/progress` | Driver owner                    | Send throttled step, remaining distance, status and ETA       |
| `POST /sessions/:sessionId/end`      | Driver owner                    | End a session with `ARRIVED`, `CANCELLED`, or `MANUAL` reason |

The OpenAPI document describes the request contracts. Progress is projected to the operations and shipment rooms. ETA is persisted on the shipment and broadcast to the public tracking room using the existing privacy-limited tracking projection.

## Navigation engine and offline behavior

`NavigationEngine` is framework-free shared TypeScript. It uses forward-biased route projection, heading preference while moving, monotonic distance progress, accuracy filtering, off-route hysteresis, one-time instruction tiers, a speed-adjusted ETA, and short dead reckoning capped at the next maneuver. The UI includes a GPS accuracy/freshness badge. Reroute calls have a per-session throttle; after five attempts in two minutes the API pauses automatic rerouting and raises a high-severity off-route alert. It reports arrival as a suggestion. The driver must confirm arrival through the existing shipment state machine.

The browser stores the normalized route and latest progress in the driver's IndexedDB database. The cached route remains visible when the API is offline. New reroutes wait for connectivity; server progress is throttled. Voice uses browser speech synthesis after the driver's start gesture and remains optional; the visual instruction stays available.

The UI labels degraded straight-line guidance and displays the driver-aid notice. Previously saved straight-line sessions are automatically retried as road routes when the driver resumes them and Valhalla is available. Drivers must follow road signs and local traffic laws. This is not certified navigation software.

## Manual review still required

Before closing Phase 14A, review on a phone with a driver account:

1. Start navigation from an active shipment and verify road geometry, the live driver marker, the labeled pickup pin, the next instruction, distance, ETA, and voice toggle.
2. Follow a short route and check that progress advances and instructions do not repeat.
3. Leave the route, confirm off-route status and automatic reroute, then return to the route.
4. Disable connectivity briefly; verify the cached route remains visible, then reconnect and confirm ETA/progress resumes.
5. Confirm arrival at pickup and verify the route target changes to delivery. Confirm delivery arrival from the navigation screen and verify it uses the shipment lifecycle action; also test manual end confirmation and confirm the driver remains assigned when only navigation ends.
6. Ask a dispatcher to verify route, progress, off-route state and ETA on the live map. Confirm the public tracking page receives ETA only.
7. Exercise a restricted-zone crossing and a Valhalla outage; check that the route is blocked or clearly flagged and that degraded guidance is labelled.

The current screen rotates the driver marker by heading and interpolates movement between location fixes. A map-wide heading-up rotation and real-device field drive remain open review items; do not treat the phase as complete until the field review is recorded. Phase 15 will add the generated-route wrong-turn and tunnel-gap simulator.
