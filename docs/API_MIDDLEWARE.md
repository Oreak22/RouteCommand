# API middleware order

Phase 3 uses one application-wide middleware chain so security headers, request IDs, validation, rate limiting, and errors behave consistently across API modules.

```text
request ID → request logger → Helmet → CORS allow-list → JSON body parser
→ cookie parser → HPP → Redis-backed rate limiter → routes
→ 404 handler → central error handler
```

The request ID middleware runs first so the ID is available to logs and every response, including parser errors. The body parser applies the configured byte limit; malformed JSON maps to `400`, and oversized JSON maps to `413`. The error handler is last and returns the standard `{ error: { code, message, details, requestId } }` envelope.

The chain is wired in `apps/api/src/app.ts`. Pino logs request IDs and omits query strings and sensitive headers. Helmet allows the HTTPS map tile providers and Swagger UI. CORS uses the configured origin allow-list with credentials. The distributed limiter stores counts in Redis. `/health/ready` checks PostgreSQL and Redis, while `/health/live` only reports process health. `/docs` and `/openapi.json` are available outside production.
