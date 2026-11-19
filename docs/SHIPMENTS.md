# Shipments

## API

All endpoints require a bearer access token.

- `POST /api/v1/shipments` — create a customer request or dispatcher shipment. Customers are always assigned from the authenticated user; dispatchers/admins must provide an active customer's ID.
- `GET /api/v1/shipments` — list shipments with status, driver, customer, priority, date, zone, search and pagination filters. Customer and driver results are scoped to their own shipments.
- `GET /api/v1/shipments/customers` — return minimal active customer choices for dispatch forms; dispatcher/admin only.
- `GET /api/v1/shipments/:shipmentId` — get a role-scoped shipment with server-calculated valid next states and cancellation permission.
- `PATCH /api/v1/shipments/:shipmentId` — update shipment details and driver assignment while the shipment is `CREATED` or `ASSIGNED`.
- `POST /api/v1/shipments/:shipmentId/transition` — request a state-machine transition. `Idempotency-Key` is optional and may contain up to 200 URL-safe characters.
- `POST /api/v1/shipments/:shipmentId/cancel` — cancel under the role-specific cancellation window; the reason is recorded in the event timeline.
- `GET /api/v1/shipments/:shipmentId/events` — read the append-only status timeline.

The API stores coordinates as PostGIS geography points in longitude/latitude order. Requests use named `lat` and `lng` fields. The dispatcher/customer form provides a map picker for both pickup and dropoff; addresses remain stored as user-entered text.

## Lifecycle and roles

| Current status    | Next status                      | Who may request it                                        |
| ----------------- | -------------------------------- | --------------------------------------------------------- |
| `CREATED`         | `ASSIGNED`                       | Admin or dispatcher; an available driver must be selected |
| `ASSIGNED`        | `ACCEPTED` or back to `CREATED`  | Assigned driver                                           |
| `ACCEPTED`        | `PICKED_UP` or back to `CREATED` | Assigned driver                                           |
| `PICKED_UP`       | `IN_TRANSIT`                     | Assigned driver                                           |
| `IN_TRANSIT`      | `ARRIVED` or `RETURNED`          | Assigned driver                                           |
| `ARRIVED`         | `DELIVERED`                      | Assigned driver                                           |
| `DELIVERED`       | `FAILED_DELIVERY`                | Admin or dispatcher                                       |
| `FAILED_DELIVERY` | `IN_TRANSIT` or `RETURNED`       | Assigned driver; admin/dispatcher may mark `RETURNED`     |

Customers can cancel their own requests while `CREATED`, `ASSIGNED` or `ACCEPTED`. Admins and dispatchers can cancel any non-terminal shipment. Drivers cannot cancel. Every transition writes the shipment status, an event and an audit record in one transaction. Domain events are published only after commit. The driver's status is kept `BUSY` while assigned work remains and returns to `AVAILABLE` after release when no other active shipment remains. Cancelling a shipment also cancels its active navigation sessions.

The transition endpoint locks the shipment row. An optional idempotency key stores the request hash and original response per shipment; replaying the same request returns the original result, while reusing its key for a different body returns `409 Conflict`.

## ETA and pickup proximity

Initial ETA uses straight-line Haversine distance at an 8 m/s average urban speed behind the `EtaEstimator` interface. It is an estimate, not a road route. Phase 14A replaces this estimate with Valhalla routing when navigation starts.

Before `PICKED_UP`, the API checks the driver's server-side last known location, signal freshness and latest telemetry accuracy. `PICKUP_PROXIMITY_RADIUS_M` defaults to 150 m. `PICKUP_PROXIMITY_MODE=SOFT` records a warning in the event note when location is missing/stale/inaccurate or outside the radius. Set it to `STRICT` to reject the transition instead. The default soft mode supports operation before Phase 8 telemetry is available.
