# API reference

The API is an Express service with versioned product endpoints under `/api/v1`. Request and response contracts are declared with Zod in `packages/shared` and `apps/api`, then assembled into an OpenAPI 3.1 document.

## Browse the live specification

When the API is running locally:

- Swagger UI: <http://localhost:3000/docs/>
- OpenAPI JSON: <http://localhost:3000/openapi.json>
- Liveness: <http://localhost:3000/health/live>
- Readiness (PostgreSQL and Redis): <http://localhost:3000/health/ready>

The running OpenAPI document is the source of truth for endpoint schemas. Use `curl -fsS http://localhost:3000/openapi.json -o openapi.json` to save a local snapshot for review. That snapshot is environment/runtime generated and is intentionally not committed as a second, potentially stale specification.

## Main endpoint groups

| Group                  | Example routes                                                | Access                                                                  |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Auth and account       | `/api/v1/auth/*`, `/api/v1/me`                                | Public login/register endpoints; session endpoints require auth         |
| Drivers and vehicles   | `/api/v1/drivers`, `/api/v1/vehicles`                         | Role-scoped; ownership enforced for driver self-service                 |
| Zones                  | `/api/v1/zones`, `/api/v1/zones/geojson`                      | Read access by operational roles; mutations limited to operations/admin |
| Shipments and dispatch | `/api/v1/shipments`, `/api/v1/dispatch/*`                     | Role, ownership, lifecycle, and capacity checked                        |
| Telemetry and metrics  | `/api/v1/telemetry/*`, `/metrics`                             | Driver identity comes from token; metrics are admin-only                |
| Alerts/security/email  | `/api/v1/alerts/*`, `/api/v1/admin/*`                         | Operational/admin scopes and audit rules apply                          |
| Navigation             | `/api/v1/navigation/*`, `/api/v1/shipments/:id/route-preview` | Driver session and assigned shipment; route preview for operations      |
| Public tracking        | `/api/v1/tracking/:trackingCode`                              | Anonymous, rate-limited, privacy-filtered projection                    |

All error responses use the common envelope with `code`, `message`, `details`, and `requestId`. Authenticated endpoints use a bearer access token unless the session cookie flow is specified. Mutating shipment transitions accept an optional `Idempotency-Key` header; queued driver actions supply a stable key.

## Local requests

Use the Swagger UI to try a request with an access token. Never commit or paste real tokens into issue reports. A direct public tracking lookup can be tested without credentials:

```sh
curl -i http://localhost:3000/api/v1/tracking/REPLACE_WITH_TRACKING_CODE
```

The full role matrix and validation schemas are described in the generated OpenAPI output and the feature documents. This guide does not replace the open Phase 20 endpoint ownership/IDOR coverage.
