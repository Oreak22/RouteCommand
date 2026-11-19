# Customer tracking

Public shipment tracking is a bearer capability: anyone holding the random tracking code may view the intentionally limited public projection. Do not include tracking links in public posts.

## Public API and privacy

- `GET /api/v1/tracking/:trackingCode` returns the same response shape for known and unknown codes and is limited by the Redis-backed `PUBLIC_TRACKING_RATE_LIMIT_*` settings.
- `GET /api/v1/tracking/:trackingCode/customer` requires a customer access token and returns the full dropoff address and full precision location only when that shipment belongs to the signed-in customer.
- Public responses omit customer details, shipment notes, event notes, driver IDs, contact details, vehicle plates, exact driver coordinates, exact destination coordinates, and the dropoff address. The driver is represented by first name and vehicle type only; the map shows an approximate destination area.
- Public driver location is rounded to the configured decimal precision and included only during `PICKED_UP`, `IN_TRANSIT`, or `ARRIVED`, while the latest accepted fix is not more than `PUBLIC_TRACKING_LOCATION_MAX_AGE_SECONDS` old. Delivery and other terminal states hide the driver location.
- Public HTTP responses use `private, no-store` and `X-Robots-Tag: noindex, nofollow, noarchive` because the payload can include shipment locations. Use the shareable tracking URL for people who need access.
- Anonymous live updates use the Socket.IO `/tracking` namespace. Unknown-code subscription acknowledgements are intentionally indistinguishable from successful subscriptions; HTTP polling every 15 seconds remains the recovery path.

The defaults round to three decimal places (roughly 100 m near the equator), hide fixes older than 30 minutes, and allow 20 public HTTP lookups per IP per minute. Tune these limits with the deployment's trusted proxy configuration and expected customer traffic.
