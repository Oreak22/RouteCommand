# Security model and verification status

This document records controls visible in the current implementation and the checks still needed. It is not a completed penetration test or a claim of production approval. Security hardening and test consolidation remain open in Phases 18 and 20.

## Assets and trust boundaries

- User credentials, refresh-session families, password-reset/verification tokens, and account state.
- Customer addresses, shipment status, driver identity/location, route geometry, zones, and operational alerts.
- The browser, public tracking endpoints, API, Redis, PostgreSQL, SMTP service, and Valhalla are separate trust boundaries.
- Driver GPS, request bodies, query parameters, browser storage, and upstream routing responses are untrusted input.
- Redis carries live state and buffered history. PostgreSQL is the durable system of record for committed data.

## Implemented controls

- Argon2id password hashes, short-lived signed access tokens, hashed rotating refresh-session tokens, reuse detection, and generic authentication failure responses.
- Shared schemas plus server-side request validation; driver identity and role come from verified credentials rather than caller-supplied IDs.
- API role and ownership checks on fleet, shipment, telemetry, alert, account, navigation, and tracking operations.
- Parameterized PostgreSQL queries, transaction-scoped state transitions, idempotency keys, uniqueness constraints, and database checks for critical conflicts.
- Helmet security headers, configured CORS, request size limits, request IDs, redacted request logs, and Redis-backed rate limits.
- Audited administrative/security actions and deduplicated security signals for the configured activity patterns.
- Public shipment tracking uses a fixed-shape unknown-code response, rate limiting, no-store behavior, and rounded/age-limited location projection. Public realtime is isolated from authenticated operational rooms.
- Authenticated realtime rooms are checked by role/ownership; full navigation geometry is restricted to the driver and operations views.
- Telemetry checks coordinates, timestamp bounds, accuracy, speed, impossible movement, and ordering; filtered points are retained with reasons but do not update live position.
- Email suppression/preferences and a local Mailpit workflow are implemented; production SMTP and sender-domain configuration remain operator responsibilities.

See [API middleware](API_MIDDLEWARE.md), [auth](AUTH.md), [tracking](TRACKING.md), [telemetry](TELEMETRY.md), and [email](EMAIL.md) for subsystem specifics.

## Verification still open

- Phase 18 has not been closed: complete the remaining role/ownership and IDOR/enumeration review, abuse and telemetry spoofing cases, dependency/security audit, and production configuration review.
- Phase 20 has not been closed: ensure integration assertions cover every protected route and event-room boundary, and run the CI security checks on a clean clone.
- Notification behavior was intentionally reduced by user direction in Phase 11A; the deferred notification rows and real provider delivery/DNS checks are listed in `docs/PROGRESS.md` and `docs/EMAIL.md`.
- No production secrets, real credentials, or real user coordinates belong in this repository. Rotate any credentials used outside a local disposable environment.

## Deployment checklist references

Use unique high-entropy JWT secrets, TLS, a restrictive `WEB_ORIGIN`, trusted proxy configuration, private PostgreSQL/Redis/Valhalla networking, persistent backups, and authenticated SMTP credentials. Do not expose Redis, PostgreSQL, or Valhalla directly to the public internet. Apply migrations as a controlled release step and do not run demo seeds in production. These deployment settings still need the Phase 18/20 review for the target host.
