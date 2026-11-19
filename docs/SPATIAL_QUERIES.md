# Spatial query proofs

These queries use PostGIS `geography` values in SRID 4326 and the GiST indexes created by migration 001. PostGIS spatial predicates such as `ST_Covers` and `ST_DWithin` include index-aware bounding-box filtering. The `<->` operator supports index-assisted K-nearest-neighbor ordering for geography; its distance is spherical.

Run `ANALYZE` after seeding and inspect each query with `EXPLAIN (ANALYZE, BUFFERS)`. At the small seed size PostgreSQL may reasonably choose a sequential scan. The plan must be rechecked against a representative larger dataset before making performance claims. To confirm that an available GiST path exists on a clean demo database, temporarily set `enable_seqscan` off for the `EXPLAIN`, then reset it; this is diagnostic only and must not be used as an application setting.

## Nearest available drivers

The origin is Victoria Island, Lagos. `ST_MakePoint` always receives longitude first and latitude second.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  id,
  last_known_location <-> ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography AS distance_m
FROM drivers
WHERE status = 'AVAILABLE'
  AND last_known_location IS NOT NULL
ORDER BY last_known_location <-> ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography
LIMIT 10;
```

Expected index: `drivers_last_known_location_gist_idx` for the KNN order, with the driver status filter applied to candidates.

## Point in active delivery zone

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name
FROM zones
WHERE is_active
  AND type = 'DELIVERY'
  AND ST_Covers(
    geom,
    ST_SetSRID(ST_MakePoint(3.40, 6.44), 4326)::geography
  );
```

Expected index: `zones_geom_gist_idx` through the bounding-box filter inside `ST_Covers`.

## Drivers inside a radius

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, user_id
FROM drivers
WHERE status = 'AVAILABLE'
  AND last_known_location IS NOT NULL
  AND ST_DWithin(
    last_known_location,
    ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography,
    2500
  )
ORDER BY ST_Distance(
  last_known_location,
  ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography
)
LIMIT 50;
```

The Phase 5 API uses this same radius predicate, then sorts the at-most-50 matches by `ST_Distance` and driver ID for stable ordering. Expected index: `drivers_last_known_location_gist_idx` for the 2,500 metre search radius. Verify with `EXPLAIN (ANALYZE, BUFFERS)`; on tiny fixtures PostgreSQL may prefer a sequential scan, so a diagnostic `SET enable_seqscan = off` can confirm the GiST path is available.

## Coordinate order

Use `toLongitudeLatitude({ longitude, latitude })` from `apps/api/src/db/coordinates.ts` when adapting named application coordinates to GeoJSON or PostGIS point construction. It validates world bounds and returns `[longitude, latitude]`; reversing these values can silently move a point to the wrong location.

## Verification record

The SQL below was run against the disposable `routecommand_phase2_check` database with 35 seeded drivers and 6 zones. Timings are a single local run on this small dataset; they are evidence of plan shape, not a performance benchmark.

| Query                                                                                     | Observed plan                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nearest available drivers, default planner with sequential scans discouraged              | `drivers_status_idx` bitmap scan followed by a sort; PostgreSQL chose this for the small available-driver candidate set.                                                                                        |
| Nearest available drivers, sequential scans, bitmap scans, and explicit sorts discouraged | KNN `Index Scan` using `drivers_last_known_location_gist_idx`; `Order By: (last_known_location <-> point)`, then `status = 'AVAILABLE'` filter. It returned 9 rows and removed 26 by filter (13.6 ms observed). |
| Nearest drivers without status filter, sequential and bitmap scans discouraged            | KNN `Index Scan` using `drivers_last_known_location_gist_idx`, with `<->` in `Order By`; returned 10 rows (0.28 ms observed).                                                                                   |
| Point in delivery zone, sequential scans discouraged                                      | `Index Scan using zones_geom_gist_idx`, with `geom && point` index condition and exact `ST_Covers` filter; returned 1 row (0.20 ms observed).                                                                   |
| Drivers within 2,500 m, sequential scans discouraged                                      | `BitmapAnd` of `drivers_status_idx` and `drivers_last_known_location_gist_idx`; exact `ST_DWithin` filter; returned 2 rows (0.08 ms observed).                                                                  |

For the nearest-available query, the unforced planner used the status B-tree and sorted because this seed is small. The forced plan confirms the spatial KNN path is available. Query planner settings were changed only in disposable `psql` sessions and reset afterward. Recheck default plans with a representative larger driver set before drawing performance conclusions.
