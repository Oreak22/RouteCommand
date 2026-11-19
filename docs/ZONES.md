# Zones and geofences

Zones are dispatcher/admin-managed PostGIS `MultiPolygon` boundaries in SRID 4326. Polygon holes,
overlapping zones, and active/inactive zones are supported. Overlaps are returned independently by
the point check; the geofencing phase will define event precedence and boundary hysteresis.

## Geometry limits

- API inputs use GeoJSON `Polygon` or `MultiPolygon`, with closed rings and at least four positions
  per ring. Positions use GeoJSON longitude, latitude order.
- Coordinates must be finite and within longitude ±180 and latitude ±90.
- Geometry is capped at 5,000 positions total and 50,000 km² per zone. PostGIS checks topology and
  rejects self-intersections; the browser also flags simple ring crossings before submit.
- Map circles are approximated by a 64-segment geodesic polygon because the database stores polygon
  geometry. Rectangles remain polygons.
- Map display simplification uses `ST_SimplifyPreserveTopology` in Web Mercator at low zoom. Zone
  details and editing APIs return the original stored geometry.

## API

- `GET /api/v1/zones` — filtered management list, including inactive zones.
- `GET /api/v1/zones/:zoneId` — one zone.
- `POST /api/v1/zones` — create; validates topology and area before insert.
- `PATCH /api/v1/zones/:zoneId` — update with `expectedUpdatedAt`; stale writes return 409.
- `DELETE /api/v1/zones/:zoneId` — soft-deactivate with `expectedUpdatedAt` in the request body.
- `GET /api/v1/zones/geojson` — active zones as a FeatureCollection; accepts optional
  `toleranceM` (0–10,000) for display simplification.
- `POST /api/v1/zones/check-point` — accepts named `lng` and `lat`, returns every active zone that
  covers that coordinate, including a point on the polygon boundary.

Every mutation is audited. A Redis cache holds the unsimplified active-zone FeatureCollection for
the geofencing engine; create, update, and deactivation invalidate it after commit. If Redis is
unavailable, reads use PostGIS and zone writes still succeed.

## Routing data

The Compose development override includes the Valhalla scripted image on the private Compose
network. It does not publish the routing port to the host. See [the local routing data guide](../apps/routing/README.md)
for the Nigeria OpenStreetMap extract setup, first tile build, refresh steps, and attribution.
