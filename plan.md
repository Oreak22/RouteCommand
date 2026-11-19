# PLAN.md — Geospatial Delivery & Logistics Command Platform

> Working name: **RouteCommand** (rename freely)
> Authors' roles: Project Manager + Engineering Lead
> Purpose: A delivery/logistics platform whose real goal is to **demonstrate the ability to ingest, store, query, secure and visualise satellite-derived (GNSS/GPS) location data in real time**. It is built as a logistics product, but architected like a command-and-control (C2) operational-picture system, so it maps directly onto defense / security-tech work (e.g. Proforce Galaxies).

---

## 0. How to Use This Document

1. Read sections 1–5 fully before writing any code. They define the rules everything else follows.
2. Build phases in the exact order given in section 7. Each phase has: **Goal, Scope, Detailed Steps, Data/Contracts, Edge Cases, Definition of Done (DoD)**.
3. Do not start a phase until the DoD of the previous one is met. Do not skip "Edge Cases".
4. Every phase ends with tests + a short entry in `docs/CHANGELOG.md`.
5. If something is unclear, record it in `docs/DECISIONS.md` (ADR style) rather than guessing silently.

---

## 1. Project Vision & Goals

### 1.1 Problem Statement

Dispatchers need a live, trustworthy picture of drivers and parcels; drivers need a simple tool to report position and update delivery status; customers need to know where their parcel is. All of this depends on continuous location telemetry that originates from satellite navigation (GNSS/GPS) on the driver's device.

### 1.2 What This Project Must Prove

| Capability                      | How the app proves it                                                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading/applying satellite data | Ingests GNSS telemetry (lat, lng, accuracy, speed, heading, altitude, timestamp), validates and filters it by quality, stores it spatially, and renders it over a **satellite imagery basemap** |
| Spatial database skill          | PostgreSQL + PostGIS, GiST indexes, `ST_DWithin`, `ST_Contains`, `ST_Distance`, `ST_MakeLine`                                                                                                   |
| Real-time engineering           | WebSocket pipeline, Redis hot cache, batched historical writes                                                                                                                                  |
| Secure API design               | JWT + refresh rotation, RBAC, input validation, rate limiting, OWASP hardening                                                                                                                  |
| Map-first UI design             | Leaflet dispatcher dashboard with performant marker rendering                                                                                                                                   |
| Resilience                      | Offline queue + auto-reconnect on the driver side                                                                                                                                               |
| Engineering discipline          | Modular backend, component-driven frontend, tests, CI, docs                                                                                                                                     |

### 1.3 Concept Mapping (Logistics ↔ Defense C2)

| Logistics feature                            | Defense-style equivalent                |
| -------------------------------------------- | --------------------------------------- |
| Driver & parcel GPS tracking                 | Tactical asset / patrol tracking        |
| Delivery zones                               | Geofencing / perimeter defense          |
| Dispatcher dashboard                         | C2 operational picture                  |
| Driver / Customer / Dispatcher / Admin roles | Tiered clearances / RBAC                |
| Offline queue + reconnect                    | Disconnected / low-bandwidth operations |
| Alerts (zone breach, signal lost, idle)      | Perimeter and asset-health alerts       |
| Route/trip replay                            | Mission replay / after-action review    |

### 1.4 Non-Goals (to avoid scope creep)

- No payments and no SMS gateway. (**Email is real**, not mocked — see Phase 11A.)
- No native mobile app (driver view is a mobile-first responsive web app / PWA).
- No hand-written routing algorithm (Dijkstra/CH on raw map data). **Turn-by-turn navigation is in scope** (Phase 14A) and is built on top of an open-source routing engine, with our own navigation-session logic (progress tracking, instruction triggering, off-route detection, rerouting, voice) layered on it.

### 1.5 Success Criteria (project-level)

- Dispatcher sees ≥ 200 simulated drivers moving live with no visible UI lag.
- Position update → dispatcher map latency < 1 second on a local network.
- Geofence entry/exit detected within one telemetry cycle.
- A driver losing connection keeps recording and syncs without data loss on reconnect.
- 100% of protected endpoints reject unauthenticated/unauthorised access (verified by tests).
- A cold-start `docker compose up` yields a working demo with seeded data.
- Real emails are delivered for every event in the notification matrix (Phase 11A), exactly once per event per recipient, with failures retried and visible in an email log.
- A driver following a generated route receives timely turn instructions (voice + visual), is detected as off-route within a few fixes, and is rerouted automatically (Phase 14A).

---

## 2. Tech Stack (Locked)

### 2.1 Frontend

| Concern          | Choice                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Framework        | React 18+ with Vite, TypeScript (strict)                                                                                |
| Styling          | Tailwind CSS                                                                                                            |
| UI kit           | **DaisyUI** (themed via Tailwind plugin)                                                                                |
| Map              | **Leaflet** via `react-leaflet`, plus `leaflet.markercluster`, `leaflet-draw` (zone drawing), `leaflet.heat` (optional) |
| Server state     | TanStack Query                                                                                                          |
| Client/UI state  | Zustand (small, focused stores)                                                                                         |
| Routing          | React Router                                                                                                            |
| Forms/validation | React Hook Form + Zod                                                                                                   |
| Realtime         | `socket.io-client`                                                                                                      |
| Icons            | `lucide-react`                                                                                                          |
| Tests            | Vitest, React Testing Library, Playwright (E2E)                                                                         |

### 2.2 Backend

| Concern              | Choice                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime              | Node.js LTS + TypeScript (strict)                                                                                                                                                                                                                                                                     |
| Framework            | Express                                                                                                                                                                                                                                                                                               |
| DB                   | PostgreSQL 15+ with **PostGIS** extension                                                                                                                                                                                                                                                             |
| DB access            | `pg` (node-postgres) with a thin repository layer; migrations via `node-pg-migrate` (raw SQL is needed for PostGIS)                                                                                                                                                                                   |
| Cache / pub-sub      | Redis (location hot cache, rate limiting, Socket.IO adapter)                                                                                                                                                                                                                                          |
| Validation           | Zod (shared request/response schemas)                                                                                                                                                                                                                                                                 |
| Auth                 | JWT access token (short) + rotating refresh token (httpOnly cookie), `argon2` password hashing                                                                                                                                                                                                        |
| Realtime             | Socket.IO                                                                                                                                                                                                                                                                                             |
| Job queue            | **BullMQ** on Redis (email sending, retries, scheduled/digest jobs)                                                                                                                                                                                                                                   |
| Email                | **Nodemailer (decided, for now)** sending over **SMTP**, wrapped behind an `EmailProvider` interface so a hosted API provider (Resend, SendGrid, SES, Postmark) can replace it later without touching business code; templates built with **React Email** or **MJML** (HTML + plain-text parts)       |
| Routing / navigation | Self-hosted open-source routing engine behind a `RoutingProvider` interface — **Valhalla recommended** (turn-by-turn maneuvers + narrative + map-matching built in); **OSRM** or **GraphHopper** are acceptable alternatives. Runs in Docker Compose with an OpenStreetMap extract of the demo region |
| Logging              | Pino (structured) + request IDs                                                                                                                                                                                                                                                                       |
| Security             | Helmet, CORS allow-list, `express-rate-limit` (Redis store), HPP                                                                                                                                                                                                                                      |
| API docs             | OpenAPI (generated from Zod, e.g. `zod-to-openapi`) + Swagger UI                                                                                                                                                                                                                                      |
| Tests                | Vitest or Jest, Supertest, Testcontainers (PostGIS + Redis)                                                                                                                                                                                                                                           |

### 2.3 Tooling & Infra

- Monorepo with npm/pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`.
- Docker Compose: `postgis/postgis`, `redis`, `api`, `web`, `worker` (BullMQ consumers — same codebase as `api`, separate process), `valhalla` (routing engine, with a mounted OSM extract), and **Mailpit** (dev-only fake SMTP inbox so emails can be inspected locally without sending real mail).
- ESLint + Prettier + Husky + lint-staged + commitlint (Conventional Commits).
- GitHub Actions CI: lint → typecheck → unit → integration → build.
- `.env.example` for every app; **no secrets in git**.

### 2.4 Satellite / External Data Sources

1. **GNSS telemetry** from the device browser Geolocation API (`watchPosition`) — this is the primary "satellite data" (lat, lng, accuracy, altitude, speed, heading).
2. **Satellite imagery basemap** in Leaflet (e.g. Esri World Imagery tiles, or NASA GIBS layers). Respect each provider's attribution and terms; make the provider URL configurable via env.
3. **Telemetry simulator** (own script) that replays realistic GNSS tracks including noise, drift, accuracy degradation, and signal loss, so the demo works without real drivers.
4. **Routing & map-matching** (required, Phase 14A): OpenStreetMap road data served by Valhalla (or OSRM/GraphHopper) — route geometry, maneuvers/instructions, distance/ETA, and snapping noisy GNSS fixes onto the road network. Behind a `RoutingProvider` adapter so the engine can be swapped.
5. Optional: reverse geocoding (Nominatim) behind an adapter interface so providers can be swapped.
6. **SMTP account for Nodemailer** (required, Phase 11A): real delivery through SMTP credentials from a mail host you control (a mailbox on your own domain, or an SMTP relay service). Use a sending domain with SPF, DKIM and DMARC configured. Behind an `EmailProvider` adapter. Check the host's sending limits before the demo; free or personal mailboxes usually cap daily volume and may rewrite or throttle mail.

> **Honest limitation to state in docs:** open-source routing gives _static_ road-network ETAs (optionally refined by speed profiles). It does **not** know live traffic. The plan never claims live-traffic routing; Phase 17 lists it as an optional extension.

---

## 3. Architecture Principles

### 3.1 Modularity Rules (Backend)

- **Feature modules**, not technical layers at the top level. Each module is self-contained and exposes a small public interface via its `index.ts`.
- Inside each module: `routes → controller → service → repository`, plus `schemas` (Zod), `types`, `tests`.
  - **Routes**: wiring only (path, middleware, controller).
  - **Controller**: parse/validate request, call service, shape response. No business logic.
  - **Service**: business rules, orchestration, transactions. No SQL, no `req/res`.
  - **Repository**: all SQL lives here. No business rules.
- Modules communicate through **service interfaces or domain events** (internal event bus), never by importing another module's repository.
- Shared infrastructure (db pool, redis client, logger, config, errors) lives in `core/` and `infra/`.
- Dependency direction: `routes → controller → service → repository → db`. Never the reverse.

```
apps/api/src/
  app.ts                  # express app assembly
  server.ts               # http + socket bootstrap, graceful shutdown
  config/                 # env parsing (Zod), constants
  core/                   # errors, http helpers, event bus, logger, result types
  infra/
    db/                   # pool, migrations runner, transaction helper
    redis/                # clients, pub/sub
    realtime/             # socket.io server, auth, rooms
  middleware/             # auth, rbac, validate, rateLimit, errorHandler, requestId
  modules/
    auth/
    users/
    drivers/
    vehicles/
    zones/
    shipments/
    dispatch/
    telemetry/
    geofence/
    alerts/
    notifications/        # notification matrix, recipient resolution, email templates, email log, preferences
    security/             # suspicious-activity detection rules + security events (feeds admin emails)
    navigation/           # routing provider adapter, route planning, navigation sessions, rerouting
    tracking/             # customer-facing public tracking
    analytics/
    audit/
  jobs/                   # background workers (telemetry flush, retention, stale detection, email queue consumers, digests)
  scripts/                # seed, simulator
  tests/
```

### 3.2 Component-Driven Rules (Frontend) — "Heavily Componentised"

The frontend is built **from components up**. No page may contain raw layout markup that could be a component. Rules:

1. **Atomic hierarchy**: `ui` (atoms) → `components` (molecules) → `features` (organisms with logic) → `pages` (composition only) → `layouts`.
2. **Pages only compose.** A page imports feature components and layouts; it holds no styling beyond placement.
3. **Features own their data.** Each feature folder has its own `api/` (query hooks), `components/`, `store/` (if needed), `types`, and `index.ts` public API.
4. **UI primitives wrap DaisyUI** (`Button`, `Input`, `Select`, `Modal`, `Badge`, `Card`, `Table`, `Tabs`, `Toast`, `Skeleton`, `EmptyState`…). Feature code never writes raw DaisyUI class soup repeatedly; it uses the primitives. This keeps the theme changeable in one place.
5. **One component per file**, named exports, typed props, no prop drilling beyond 2 levels (use composition, context, or Zustand).
6. **Presentational vs container**: presentational components receive data via props and are Storybook/test friendly; hooks fetch/transform data.
7. **Every component has**: typed props interface, loading/empty/error states where relevant, accessibility attributes, and a test for non-trivial behaviour.
8. **Map is a first-class module**: `features/map` exposes `MapCanvas`, layer components (`DriversLayer`, `ZonesLayer`, `ShipmentsLayer`, `TrailLayer`, `HeatLayer`, `BaseLayerSwitcher`), and controls. Feature pages add layers as children.

```
apps/web/src/
  main.tsx
  app/
    App.tsx
    router.tsx
    providers/            # QueryProvider, ThemeProvider, SocketProvider, AuthProvider
    guards/               # RequireAuth, RequireRole
  theme/
    daisyui.config.ts     # themes (light/dark/tactical)
    tokens.md             # design tokens documentation
    index.css             # tailwind layers + custom utilities
  layouts/
    AppShell/             # sidebar + topbar + content outlet
    AuthLayout/
    MapLayout/            # full-bleed map with floating panels
    PublicLayout/         # customer tracking
    DriverLayout/         # mobile-first bottom nav
  components/
    ui/                   # Button, Input, Modal, Badge, Card, Table, Tabs, Toast, Skeleton, ...
    common/               # PageHeader, StatCard, ConfirmDialog, SearchBar, StatusPill, DataTable, ...
  features/
    auth/
    map/
    drivers/
    shipments/
    zones/
    dispatch/
    tracking/
    alerts/
    telemetry/            # driver-side GNSS capture + offline queue
    navigation/           # turn-by-turn UI: NavigationPanel, ManeuverCard, RouteLayer, EtaBar, VoiceToggle, ReroutePrompt
    notifications/        # notification preferences, in-app notification list
    analytics/
    admin/                # users, security events, email log
  hooks/                  # generic hooks (useDebounce, useMediaQuery, ...)
  lib/                    # api client, socket client, utils, formatters, geo helpers
  types/
  pages/                  # thin route components
```

### 3.3 Shared Package (`packages/shared`)

Single source of truth for: Zod schemas, TypeScript types/enums (roles, shipment statuses, alert types), socket event names and payload types, constants (e.g. max accuracy threshold). Both apps import from here, preventing contract drift.

### 3.4 Cross-Cutting Conventions

- **API**: REST, versioned `/api/v1`, JSON, consistent envelope:
  `{ "data": ..., "meta": { ... } }` for success; `{ "error": { "code", "message", "details", "requestId" } }` for failure.
- **IDs**: UUID v4 (public) — never expose sequential IDs.
- **Time**: store UTC `timestamptz`; transmit ISO-8601; display in user's timezone on the client.
- **Coordinates**: always `(lng, lat)` order in PostGIS and GeoJSON; always label clearly in the UI/API (`lat`, `lng` named fields). SRID **4326**; use `geography` for distance/radius queries.
- **Pagination**: cursor-based for large lists (telemetry, audit), offset acceptable for small admin tables.
- **Errors**: typed `AppError` subclasses (`ValidationError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `ConflictError`) mapped centrally.
- **Naming**: `snake_case` in DB, `camelCase` in TS/JSON.
- **Git**: trunk-based with short-lived feature branches, Conventional Commits, PRs required to pass CI.

---

## 4. Roles & Permissions (RBAC)

| Role         | Description                 | Key permissions                                                                                                         |
| ------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ADMIN`      | System owner                | Everything, including user management, zone management, audit log, system settings                                      |
| `DISPATCHER` | Operations controller       | View all drivers/shipments live, create/assign shipments, manage zones (read/write), acknowledge alerts, view analytics |
| `DRIVER`     | Field operator              | View/update **own** profile, own assigned shipments, send **own** telemetry, update own shipment status                 |
| `CUSTOMER`   | Parcel recipient/sender     | View **own** shipments only, track own parcel live                                                                      |
| _(public)_   | Anyone with a tracking code | Read-only limited tracking view (no PII, delayed/rounded location option)                                               |

Rules:

- Enforcement is **server-side only**; UI hiding is cosmetic.
- **Object-level checks** (a driver may only touch resources assigned to them) are mandatory, not just role checks.
- A permissions matrix lives in `packages/shared/permissions.ts` and is used by both apps. Tests assert the matrix against real endpoints.

---

## 5. Domain Model

### 5.1 Entities

- **User**: id, email, **email_verified_at**, password_hash, name, phone, role, is_active, last_login_at, timestamps
- **RefreshToken**: id, user_id, token_hash, family_id, expires_at, revoked_at, replaced_by, user_agent, ip
- **Driver**: id, user_id (1:1), status (`OFFLINE|AVAILABLE|BUSY|ON_BREAK`), vehicle_id, license_no, rating, last_known_location (geography Point), last_seen_at
- **Vehicle**: id, plate, type (`BIKE|CAR|VAN|TRUCK`), capacity_kg, is_active
- **Zone**: id, name, type (`DELIVERY|RESTRICTED|DEPOT|CUSTOM`), geom (geography Polygon/MultiPolygon), color, is_active, created_by
- **Shipment**: id, tracking_code (unique, non-guessable), customer_id, driver_id (nullable), status, pickup (address + point), dropoff (address + point), weight_kg, priority, notes, scheduled_at, picked_up_at, delivered_at, eta, timestamps
- **ShipmentEvent**: id, shipment_id, status, actor_id, note, location (nullable point), created_at (append-only audit of state changes)
- **TelemetryPoint** (history): id, driver_id, shipment_id (nullable), location (geography Point), accuracy_m, speed_mps, heading_deg, altitude_m, recorded_at (device time), received_at (server time), source (`DEVICE|SIMULATOR`), battery_pct (nullable), is_filtered (bool)
- **Alert**: id, type (`ZONE_ENTER|ZONE_EXIT|RESTRICTED_ZONE_BREACH|SIGNAL_LOST|IDLE_TOO_LONG|SPEEDING|LOW_ACCURACY|SHIPMENT_DELAYED|OFF_ROUTE`), severity, driver_id, shipment_id, zone_id, payload JSONB, status (`OPEN|ACKNOWLEDGED|RESOLVED`), acknowledged_by, timestamps
- **GeofenceState**: driver_id, zone_id, is_inside, since (prevents duplicate enter/exit alerts)
- **AuditLog**: id, actor_id, action, entity, entity_id, metadata JSONB, ip, created_at
- **NotificationEvent**: id, type (see matrix in Phase 11A), entity (`shipment|user|security_event`), entity_id, dedupe_key (unique), payload JSONB, created_at — the "something happened that someone must be told about" record
- **EmailLog**: id, notification_event_id, recipient_user_id (nullable), recipient_email, template, subject, status (`QUEUED|SENDING|SENT|FAILED|BOUNCED|COMPLAINED|SUPPRESSED`), provider, provider_message_id, attempts, last_error, queued_at, sent_at (never stores the full body — only template + variables reference)
- **NotificationPreference**: user_id, type, email_enabled (security and account emails cannot be disabled)
- **EmailSuppression**: email (citext, unique), reason (`HARD_BOUNCE|COMPLAINT|MANUAL`), created_at — addresses we must not send to again
- **SecurityEvent**: id, type (`LOGIN_BRUTE_FORCE|REFRESH_TOKEN_REUSE|NEW_DEVICE_LOGIN|IMPOSSIBLE_TRAVEL|PRIVILEGE_ESCALATION_ATTEMPT|IDOR_PROBING|TELEMETRY_SPOOFING|MASS_REQUEST_CREATION|CREDENTIAL_CHANGE_BURST|ACCOUNT_LOCKED|…`), severity, user_id (nullable), ip, user_agent, evidence JSONB, status (`OPEN|REVIEWED|DISMISSED`), reviewed_by, created_at
- **NavigationSession**: id, driver_id, shipment_id, status (`PLANNED|ACTIVE|OFF_ROUTE|REROUTING|ARRIVED|CANCELLED`), route (GeoJSON LineString + steps JSONB), waypoints JSONB (ordered stops), distance_m, duration_s, current_step_index, started_at, ended_at, reroute_count, provider, provider_request_id

### 5.2 Shipment State Machine (strict)

```
CREATED → ASSIGNED → ACCEPTED → PICKED_UP → IN_TRANSIT → ARRIVED → DELIVERED
   │          │          │           │            │          │
   └──────────┴──────────┴───────────┴────────────┴──────────┴──→ CANCELLED
                     ASSIGNED/ACCEPTED → (driver rejects) → CREATED (re-dispatch)
DELIVERED can also branch to → FAILED_DELIVERY → (retry) IN_TRANSIT | RETURNED
```

- Transitions are validated in one place (`shipments/stateMachine.ts`) with a transition table. Invalid transitions return `409 Conflict`.
- Every transition writes a `ShipmentEvent` in the **same DB transaction**.
- Each transition declares which roles may perform it.
- **Cancellation rules:** a `CUSTOMER` may cancel their own shipment only while it is `CREATED`, `ASSIGNED` or `ACCEPTED` (i.e. before pickup). After `PICKED_UP` only a `DISPATCHER`/`ADMIN` may cancel. Every cancellation records the actor and reason and emits `shipment.cancelled` (this drives the cancellation emails in Phase 11A).
- **Notification-relevant transitions** (emit domain events consumed by Phase 11A): request created by a customer → `shipment.requested`; `→ ASSIGNED` → `shipment.assigned`; `→ PICKED_UP`, `→ IN_TRANSIT`, `→ ARRIVED`, `→ DELIVERED` → `shipment.statusChanged`; `→ CANCELLED` → `shipment.cancelled`.

---

## 6. Frontend Layout & Theme — DEFINED FIRST (Phase 1)

> This is a hard rule: **layout and theme are designed and built before any feature screen.** Every later screen only plugs into the layouts and uses theme tokens. No ad-hoc colors, spacing, or one-off layouts.

### 6.1 Theme Specification

- Implemented with DaisyUI custom themes in `theme/daisyui.config.ts`. Provide at least:
  - `routecommand-dark` (default, "operations/tactical" look — dark neutral, high-contrast accents)
  - `routecommand-light`
- **Semantic tokens** (use only these, never raw hex in components): `primary`, `secondary`, `accent`, `neutral`, `base-100/200/300`, `info`, `success`, `warning`, `error`.
- **Domain colors** (defined once as CSS variables / Tailwind extensions): driver statuses (available/busy/offline/break), shipment statuses, alert severities, zone types. These feed map markers, badges, and charts so everything stays consistent.
- **Typography**: one sans family for UI, one monospace for coordinates/IDs/timestamps (aids the "operational" feel). Define a type scale (xs → 3xl) and use only that scale.
- **Spacing/radius/shadow**: use the Tailwind scale only; define standard radii (`rounded-box`, `rounded-btn`) via DaisyUI tokens.
- **Dark/light toggle** persisted in localStorage; respects `prefers-color-scheme` on first visit.
- Document everything in `theme/tokens.md` with a visual reference page route `/__styleguide` (dev only) showing every primitive in every state.

### 6.2 Layout Specification

| Layout         | Used by                                           | Structure                                                                                                                                                 |
| -------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthLayout`   | login, register, forgot password                  | Centered card, brand panel, theme toggle                                                                                                                  |
| `AppShell`     | admin/dispatcher pages (tables, forms, analytics) | Collapsible sidebar (role-aware nav), top bar (search, alerts bell with count, theme toggle, user menu), scrollable content outlet, breadcrumb/PageHeader |
| `MapLayout`    | live map, zone editor, replay                     | Full-bleed Leaflet canvas; floating collapsible panels (left: lists/filters, right: details, bottom: timeline/replay controls); top bar kept slim         |
| `DriverLayout` | driver app                                        | Mobile-first, bottom tab bar (Jobs, Map, Status, Profile), big touch targets, connection/GNSS status strip always visible                                 |
| `PublicLayout` | customer tracking page                            | Minimal header, map + status timeline, no auth chrome                                                                                                     |

Layout rules:

- Responsive breakpoints defined once; dispatcher pages must be usable ≥ 1024px, driver/public pages ≥ 360px.
- Each layout exposes slots (`header`, `sidebar`, `content`, `footer`) via composition, not props soup.
- Global concerns live in layouts only: toast container, connection-status banner, error boundary, global loading bar.
- Accessibility baseline: keyboard navigation, visible focus, ARIA landmarks, color-contrast ≥ WCAG AA, `prefers-reduced-motion` respected.

### 6.3 UI Primitive Inventory (must exist before features)

`Button, IconButton, Input, PasswordInput, Textarea, Select, Combobox, Checkbox, Toggle, RadioGroup, FormField (label+error+hint), Modal, Drawer, ConfirmDialog, Dropdown, Tabs, Badge, StatusPill, Avatar, Card, StatCard, Table/DataTable (sort, pagination, empty, loading), Pagination, Tooltip, Toast, Skeleton, Spinner, EmptyState, ErrorState, Stepper/Timeline, Breadcrumbs, SearchBar, Kbd, CopyButton`.

---

## 7. Execution Plan — Phase by Phase (Strict Order)

Legend: **DoD** = Definition of Done.

---

### PHASE 0 — Project Setup & Tooling

**Goal:** A reproducible, linted, typed, containerised monorepo skeleton.

**Steps**

1. Create repo; init workspaces: `apps/web`, `apps/api`, `packages/shared`.
2. TypeScript: root `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, path aliases; per-package configs extend it.
3. ESLint (typescript-eslint, react-hooks, import ordering, jsx-a11y for web) + Prettier; share config at root.
4. Husky pre-commit (lint-staged: eslint + prettier + typecheck on staged), commit-msg (commitlint).
5. `docker-compose.yml`: `postgis/postgis` (with healthcheck), `redis` (healthcheck), **`mailpit`** (dev SMTP inbox), volumes, networks. Separate `docker-compose.override.yml` for dev hot reload. The `worker` (queue consumers) and `valhalla` (routing) services are added in the phases that first need them (Phases 4 and 6 respectively — see the note under the order table in section 8).
6. `.env.example` for api and web; env parsing in the API validated with Zod — **app refuses to boot on invalid env**.
7. `packages/shared`: scaffold build (tsup/tsc), export barrel; wire as workspace dependency of both apps.
8. Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`, `sim`.
9. GitHub Actions CI skeleton: install (cached) → lint → typecheck → test → build.
10. Docs scaffolding: `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/API.md` (generated later), `docs/DEMO_SCRIPT.md`, and **`docs/PROGRESS.md`** (the phase checklist every contributor and AI agent reads first and updates last — see `agent.md`). Place `plan.md` and `agent.md` in the repository root.

**Edge cases:** Windows/macOS/Linux line endings (`.gitattributes`); Node version pinned (`.nvmrc`, `engines`); port conflicts documented.

**DoD:** `docker compose up -d` starts DB+Redis healthy; `npm run dev` boots empty api (`GET /health` → 200) and empty web; CI green; commit hooks work.

---

### PHASE 1 — Frontend Foundation: Theme, Layouts, UI Primitives

**Goal:** The complete design system and layout shells exist and are consistent **before any feature work**.

**Steps**

1. Install and configure Tailwind + DaisyUI; create custom themes (section 6.1); wire the `ThemeProvider` (toggle, persistence, system preference).
2. Define domain color tokens (driver status, shipment status, alert severity, zone type) in one file; export typed helpers `getStatusColor(...)`.
3. Typography setup (fonts loaded locally or via a self-hosted package; no layout shift; monospace utility class `font-data`).
4. Build every primitive in section 6.3 under `components/ui`, each with: typed props, variants/sizes, disabled/loading/error states, a11y attributes, and a unit test for behaviour.
5. Build `common` composites: `PageHeader`, `StatCard`, `DataTable`, `StatusPill`, `ConfirmDialog`, `FormField`, `EmptyState`, `ErrorState`, `ConnectionBanner`.
6. Build all five layouts (section 6.2) as real, navigable shells with placeholder content. `AppShell` sidebar navigation is **config-driven** (array of `{label, icon, path, roles}`) so role-based menus need no markup changes.
7. Build `app/` infrastructure: Router (lazy routes, `Suspense` fallbacks), `ErrorBoundary`, `RequireAuth`/`RequireRole` guard stubs, 404 page, Query/Toast providers.
8. Build the dev-only `/__styleguide` page demonstrating every primitive and the colour tokens in both themes.
9. Add Leaflet CSS + marker icon fix; build a **bare** `MapCanvas` component (OSM + satellite base layer switcher, scale control, attribution) used by `MapLayout`. No data yet.
10. Document conventions in `docs/FRONTEND_GUIDE.md` (file naming, component template, how to add a feature, theming rules).

**Edge cases:** Flash of wrong theme on load (set theme attribute before React hydrates via inline script); Leaflet default marker icons breaking under Vite; sidebar state on mobile (drawer) vs desktop (collapsible); long text overflow in tables/badges; RTL not required but avoid hard-coded left/right where logical properties exist.

**DoD:** Styleguide page shows all components in light + dark; all five layouts render and switch correctly at breakpoints; Lighthouse accessibility ≥ 90 on styleguide; component tests pass; **no feature code written yet**. Phase 1 was closed at the user's direction under ADR-003 with Lighthouse deferred because npm registry DNS was unavailable; the score remains unverified and must be rerun when access returns, no later than Phase 20.

---

### PHASE 2 — Database Foundation (PostgreSQL + PostGIS)

**Goal:** Versioned schema with spatial types and indexes, plus seed data.

**Steps**

1. Migration 001: enable extensions `postgis`, `pgcrypto` (UUIDs), `citext`.
2. Create enums: `user_role`, `driver_status`, `vehicle_type`, `shipment_status`, `zone_type`, `alert_type`, `alert_severity`, `alert_status`, `telemetry_source`.
3. Create tables from section 5.1 with: PKs (UUID default `gen_random_uuid()`), FKs with explicit `ON DELETE` behaviour, `NOT NULL`/`CHECK` constraints (e.g. lat/lng validity via PostGIS, `accuracy_m >= 0`, `speed_mps >= 0`, heading 0–360), `created_at/updated_at` with trigger for `updated_at`.
4. Spatial columns: `geography(Point,4326)` for points, `geography(Polygon,4326)` (or MultiPolygon) for zones.
5. **Indexes**:
   - GiST on every spatial column (`drivers.last_known_location`, `zones.geom`, `shipments` pickup/dropoff points, `telemetry_points.location`).
   - B-tree: `telemetry_points (driver_id, recorded_at DESC)`, `shipments (status)`, `shipments (driver_id, status)`, `shipments (tracking_code)` unique, `alerts (status, created_at DESC)`, `users (email)` unique (citext).
   - BRIN on `telemetry_points.recorded_at` if table is large.
6. Telemetry table strategy: **range-partition `telemetry_points` by month** (or document why deferred) and create a retention job hook (Phase 14).
7. Repository foundation: pg `Pool` (configured max, idle timeout, statement timeout), `withTransaction(fn)` helper, query logging in dev, health check query.
8. Seed script: 1 admin, 2 dispatchers, 30–50 drivers + vehicles, 20 customers, 5–8 zones (a city split into delivery zones, one restricted zone, one depot), ~100 shipments across statuses. Deterministic (seeded RNG) and idempotent.
9. Write SQL "proof queries" in `docs/SPATIAL_QUERIES.md` and verify with `EXPLAIN ANALYZE` that GiST indexes are used (nearest driver, point-in-zone, drivers in radius).

**Edge cases:** `geography` vs `geometry` pitfalls (ST_Contains needs geometry cast, or use `ST_Covers` with geography); lng/lat order mistakes (add a helper + test); antimeridian/poles not required but document; timezone handling (`timestamptz` only); migration rollback (`down`) for each migration.

**DoD:** `db:migrate` up/down works on a clean DB; seed produces a realistic dataset; documented `EXPLAIN` output shows index usage; schema reviewed against section 5. **Met 2026-11-14:** migration up/down/re-up, idempotent seed, PostGIS health, transaction commit/rollback, spatial plan evidence, lint, typecheck, tests, and build were verified; see `docs/PROGRESS.md` and `docs/SPATIAL_QUERIES.md`.

---

### PHASE 3 — Backend Core Infrastructure

**Goal:** Production-grade skeleton every module plugs into.

**Steps**

1. `config/`: Zod-validated env (DB URL, Redis URL, JWT secrets/TTLs, CORS origins, tile/provider URLs, thresholds, rate limits).
2. `core/errors`: `AppError` hierarchy + error-code enum; central `errorHandler` middleware producing the standard envelope; never leak stack traces in production.
3. Logging: Pino with request ID (`x-request-id` generated/propagated), redaction of `authorization`, `cookie`, `password`, tokens; log level via env.
4. Middleware chain order (document it): requestId → logger → helmet → CORS → body parser (size limits) → cookie parser → HPP → rate limiter → routes → 404 → errorHandler.
5. `validate(schema)` middleware for `body/query/params` using shared Zod schemas; strips unknown keys; returns 422 with field-level details.
6. `asyncHandler` wrapper (or Express 5 native) so thrown errors reach the handler.
7. Redis client module (separate clients for cmd/pub/sub), connection retry, health check.
8. Health endpoints: `/health/live` (process), `/health/ready` (DB + Redis).
9. Graceful shutdown: stop accepting connections, close sockets, flush telemetry buffer, close DB/Redis, with a timeout.
10. Internal **event bus** (typed EventEmitter wrapper) for module decoupling (`telemetry.received`, `geofence.crossed`, `shipment.requested`, `shipment.assigned`, `shipment.statusChanged`, `shipment.cancelled`, `alert.created`, `security.event`, `navigation.offRoute`, `navigation.arrived`). Events are published **after** the DB transaction commits (never inside it), so a rolled-back change never sends an email.
11. OpenAPI generation pipeline + Swagger UI at `/docs` (dev/staging only).
12. Test harness: Testcontainers spin-up of PostGIS + Redis; helpers to create authed clients per role; DB reset between suites.

**Edge cases:** Malformed JSON (400 not 500); oversized payloads (413); unhandled promise rejections/uncaught exceptions logged then process exits cleanly; trust proxy setting for correct client IP behind a reverse proxy.

**DoD:** Booting with bad env fails with a clear message; error handler covered by tests for each error type; health endpoints reflect real dependency state; Swagger UI loads; integration test harness runs in CI.

---

### PHASE 4 — Authentication & Authorization

**Goal:** Secure identity, sessions, and RBAC used by everything else.

**Backend steps**

1. Module `auth` + `users`. Endpoints:
   - `POST /auth/register` (customer self-signup only; other roles created by admin)
   - `POST /auth/login`
   - `POST /auth/refresh`
   - `POST /auth/logout` (revoke current refresh token) and `POST /auth/logout-all`
   - `GET /auth/me`
   - `POST /auth/change-password`
   - `POST /auth/verify-email` and `POST /auth/resend-verification` (single-use, hashed, expiring token sent by **real email** via Phase 11A)
   - `POST /auth/forgot-password` / `POST /auth/reset-password` (single-use, hashed, short-lived token sent by **real email**; response is identical whether or not the email exists, to prevent user enumeration; reset revokes all refresh-token families)
2. Passwords: `argon2id`, minimum policy (length ≥ 10, breached/common list check optional), constant-time compare, generic login error messages (no user enumeration).
3. Access token: JWT, 10–15 min TTL, claims `{sub, role, sid}`; signed with a strong secret from env; algorithm pinned (reject `none`).
4. Refresh token: opaque random 256-bit value, **stored hashed**, in `httpOnly; Secure; SameSite=Strict` cookie, path-scoped to `/api/v1/auth`.
5. **Rotation with reuse detection**: each refresh issues a new token in the same `family_id`; presenting an already-used token revokes the whole family (forces re-login) and logs a security audit event.
6. Account lockout / progressive delay after repeated failed logins (Redis counters per account + IP); stricter rate limit on auth routes.
7. Middleware: `authenticate` (verify JWT, load minimal user, reject inactive users), `authorize(...roles)`, and **ownership guards** (`assertDriverOwnsShipment`, `assertCustomerOwnsShipment`).
8. Admin user management (`users` module): CRUD, activate/deactivate, role change (audited), force password reset; creating a `DRIVER` user also creates the `Driver` record in one transaction.
9. Audit logging for: login success/failure, logout, password change, role change, token reuse detection.
10. Socket authentication hook designed now (used in Phase 9): verify JWT on handshake, re-verify on token refresh.
11. **Security signal emission (feeds Phase 11A's suspicious-activity detection):** auth emits structured `security.signal` events for failed logins (with account + IP), account lockouts, refresh-token reuse, new device/IP/user-agent logins, password/email/role changes, and 401/403 bursts. Auth only _emits_ signals; the `security` module decides what counts as suspicious.
12. Record `last_login_ip`, a hashed device fingerprint (user-agent + coarse IP) and approximate IP geolocation (offline GeoIP database such as MaxMind GeoLite2 — no external call per login) on each session so "new device" and "impossible travel" rules have data to work with.

**Frontend steps (`features/auth`)**

1. Pages: Login, Register (customer), Forgot Password, Reset Password, Verify Email (landing + "resend"), Change Password.
2. `AuthProvider`: holds user in memory (access token **in memory only**, never localStorage); silent refresh on app load and before expiry; single in-flight refresh (queue concurrent 401s).
3. Axios/fetch client with interceptors: attach token, retry once after refresh on 401, redirect to login on refresh failure.
4. `RequireAuth` / `RequireRole` guards using the shared permissions matrix; role-based post-login redirect (admin/dispatcher → live map, driver → jobs, customer → my shipments).
5. Form handling: React Hook Form + shared Zod schemas, inline errors, disabled-while-submitting, accessible error summaries.

**Edge cases:** Clock skew on JWT expiry; multiple tabs logging out (use `BroadcastChannel` to sync logout); refresh race conditions; deactivated user with a valid token (checked per request or via short TTL + session table); CSRF considerations for cookie-based refresh (SameSite + custom header check on refresh/logout).

**Tests:** every endpoint × every role matrix (allowed vs 401/403); refresh rotation and reuse-detection; lockout; password hashing; token tampering; deactivated-user access.

**DoD:** Matrix test suite green; manual flow login → refresh → logout works across tabs; no token in localStorage/sessionStorage; Swagger documents auth with security schemes.

---

### PHASE 5 — Vehicles & Drivers

**Goal:** Manage the fleet and driver profiles/status.

**Backend**

1. Endpoints (ADMIN/DISPATCHER unless noted):
   - `GET/POST /vehicles`, `GET/PATCH/DELETE (soft) /vehicles/:id`
   - `GET /drivers` (filters: status, zone, vehicle type, search; pagination), `GET /drivers/:id`, `PATCH /drivers/:id`
   - `GET /drivers/me`, `PATCH /drivers/me/status` (DRIVER: only `OFFLINE|AVAILABLE|ON_BREAK`; `BUSY` is system-controlled)
   - `POST /drivers/:id/assign-vehicle`
2. Business rules: a vehicle can be assigned to one active driver; a driver with active shipments cannot go `OFFLINE` without a warning/forced flag; status changes emit events and are timestamped.
3. `GET /drivers/nearby?lng=&lat=&radiusM=&status=AVAILABLE` using `ST_DWithin` + `ST_Distance` ordered by distance, limited (max 50). Validate radius bounds.
4. Soft-delete everywhere (`is_active`); deleted entities remain referenceable by history.

**Frontend (`features/drivers`)**

- `DriversTable` (filters, status pills, last-seen relative time), `DriverDetailDrawer`, `DriverForm`, `VehicleForm`, `DriverStatusToggle` (driver layout), `VehicleList`.
- Query hooks + optimistic update for status changes with rollback on failure.

**Edge cases:** Driver with no location yet (show "No signal" not 0,0); stale `last_seen_at` → derive "Offline/Signal lost" client-side and server-side; duplicate plates (409); concurrency on vehicle assignment (transaction + unique partial index).

**DoD:** CRUD + nearby search tested (including empty results, boundary radius); UI tables handle loading/empty/error; role checks verified.

---

### PHASE 6 — Zones & Geofencing Definitions

**Goal:** Create, store, validate, and display spatial boundaries.

**Backend**

1. Endpoints: `GET /zones`, `GET /zones/:id`, `POST /zones`, `PATCH /zones/:id`, `DELETE /zones/:id` (soft), `GET /zones/geojson` (FeatureCollection for the map), `POST /zones/check-point` (which zones contain this point).
2. Accept **GeoJSON** polygons; validate: closed ring, ≥ 4 points, valid coordinates range, `ST_IsValid` (reject self-intersections with a clear error, optionally `ST_MakeValid` with explicit opt-in), max vertex count, max area sanity check.
3. Point-in-zone queries: `ST_Covers(zone.geom, point)` using the GiST index; cache the active-zones set in memory/Redis with invalidation on zone change (used by the geofence engine in Phase 10).
4. Zone types drive behaviour: `DELIVERY` (service boundary), `RESTRICTED` (entering raises a high-severity alert), `DEPOT` (arrival/departure tracking), `CUSTOM`.

**Frontend (`features/zones`, `features/map`)**

- `ZonesLayer` renders GeoJSON polygons styled by zone-type tokens, hover highlight, tooltip with name/type.
- `ZoneEditor` (MapLayout): `leaflet-draw` toolbar for polygon/rectangle/circle→polygon, edit vertices, delete, a side panel form (name, type, colour, active), live validation feedback (self-intersection warning), confirm-on-delete.
- Zone list panel with search, visibility toggles, "fly to zone".

**Edge cases:** Overlapping zones (allowed; document behaviour); polygons with holes; very large polygons impacting render performance (simplify for display with `ST_SimplifyPreserveTopology` at low zoom); concurrent edits (updated_at optimistic check).

**DoD:** Draw → save → reload → renders identical; invalid geometry rejected with helpful message; `check-point` correct for inside/outside/on-boundary tests.

---

### PHASE 7 — Shipments & State Machine

**Goal:** Full shipment lifecycle with strict transitions and auditability.

**Backend**

1. Endpoints:
   - `POST /shipments` (DISPATCHER/ADMIN; CUSTOMER may create requests limited to own account)
   - `GET /shipments` (filters: status, driver, customer, date range, zone, priority, search by tracking code; role-scoped results)
   - `GET /shipments/:id` (role-scoped), `PATCH /shipments/:id` (only while `CREATED`/`ASSIGNED`)
   - `POST /shipments/:id/transition` `{ toStatus, note, location? }` (single endpoint, state machine enforced)
   - `GET /shipments/:id/events` (timeline)
2. Tracking code: cryptographically random, human-friendly (e.g. `RC-` + 10 chars Crockford base32), unique, not derivable from sequential data.
3. Validate pickup/dropoff coordinates; optional geocoding adapter (interface + mock/Nominatim implementation); store both address text and point.
4. State machine module with transition table `{from, to, allowedRoles, requires}`; e.g. `PICKED_UP` requires driver within X metres of pickup (configurable, soft-warning mode available) — uses last known location and accuracy.
5. Every transition: single DB transaction updating shipment + inserting `ShipmentEvent` + updating driver status (`BUSY` while active jobs) → emit `shipment.statusChanged`.
6. ETA field: start with a simple haversine distance ÷ average-speed estimate behind an `EtaEstimator` interface; **Phase 14A replaces it with routing-engine ETAs** (real road distance/duration, continuously updated during navigation) and falls back to the simple estimator if the routing engine is unreachable.
7. Idempotency: transition requests carry an optional `Idempotency-Key`; duplicate submissions (driver on flaky network) return the original result.
8. Concurrency: use `SELECT ... FOR UPDATE` (or version column) so two actors cannot transition the same shipment simultaneously.
9. **Customer-initiated requests & cancellation:** `POST /shipments` by a `CUSTOMER` creates a request in status `CREATED` and emits `shipment.requested` (after commit). `POST /shipments/:id/cancel` `{ reason }` follows the cancellation rules in section 5.2 and emits `shipment.cancelled` carrying the actor role, reason and the previously assigned driver (if any) so notifications can reach the right people. Cancelling an `ASSIGNED`/`ACCEPTED` shipment also frees the driver (`BUSY` → `AVAILABLE` if no other active jobs) and cancels any active navigation session for it.

**Frontend (`features/shipments`)**

- `ShipmentsTable`, `ShipmentFilters`, `ShipmentForm` (with map point-picker component `LocationPicker` reused for pickup/dropoff), `ShipmentDetailPanel`, `StatusTimeline`, `StatusPill`, `TransitionActions` (shows only valid next actions for the user's role), `TrackingCodeBadge` (copy).
- Customer: "My Shipments" list and detail.

**Edge cases:** Illegal transition (409 with allowed list in response); transition after cancel; driver reassigned mid-flight; pickup far from driver (warning vs block); duplicate tracking code collision retry; timezone display of scheduled times.

**DoD:** Table-driven tests cover **every** valid and invalid transition per role; timeline accurate; idempotency verified; customer cannot see others' shipments (tested).

---

### PHASE 8 — Telemetry Ingestion Pipeline (Core of the Satellite-Data Story)

**Goal:** Receive GNSS telemetry, validate and quality-filter it, cache the latest position, and persist history efficiently.

**Understanding the data (document in `docs/TELEMETRY.md`)**
Each fix includes: `lat, lng, accuracy_m` (horizontal accuracy radius), `altitude_m`, `speed_mps`, `heading_deg`, `recorded_at` (device clock), optional `battery_pct`. Accuracy depends on visible satellites/environment; the app must treat accuracy as a first-class signal, not ignore it.

**Backend steps (module `telemetry`)**

1. Ingestion channels:
   - **Primary:** Socket.IO event `telemetry:update` (single or batch) from authenticated drivers.
   - **Fallback:** `POST /telemetry/batch` (HTTP) for offline-sync flushes and when sockets are unavailable.
2. **Validation (Zod + domain rules)**:
   - lat ∈ [-90, 90], lng ∈ [-180, 180], reject NaN/Infinity, reject exact (0,0) "null island" as invalid.
   - `accuracy_m` required; configurable thresholds: > `MAX_ACCURACY_M` (e.g. 100 m) → stored but flagged `is_filtered=true` and **not** used for live position or geofence decisions; raises `LOW_ACCURACY` alert when sustained.
   - `speed_mps` ≥ 0 and ≤ plausible max for vehicle type; `heading` 0–360 or null.
   - **Timestamp sanity**: reject future timestamps beyond skew tolerance; accept old timestamps only via batch/sync (bounded age); reject out-of-order older than the latest accepted for live display (but still store for history).
   - **Teleport/jump detection**: compute implied speed from previous accepted fix; if physically impossible, flag as anomalous and exclude from live view.
   - Batch size cap (e.g. 500 points), payload size cap, per-driver rate limit (e.g. max N updates/sec) via Redis.
3. **Authorisation**: a driver may only submit telemetry for **their own** `driver_id` (derived from the token, never trusted from the payload). Simulator uses a dedicated service credential/role scoped to simulation.
4. **Hot path (Redis)**: on each accepted fix `HSET driver:{id}:loc {...}` and `GEOADD drivers:geo lng lat id`, with TTL/heartbeat key `driver:{id}:seen`. Publish to a Redis channel for fan-out (Phase 9). The hot path **must not hit PostgreSQL synchronously**.
5. **Cold path (PostgreSQL)**: an in-memory/Redis-backed buffer collects accepted points and a flush job bulk-inserts (multi-row `INSERT` or `COPY`) every N seconds or M points, whichever first; updates `drivers.last_known_location/last_seen_at` at a **throttled** rate (e.g. ≤ once per 10 s per driver) to avoid write storms.
6. **Reliability of the buffer**: on graceful shutdown flush; on crash accept bounded loss for in-memory buffer or use a Redis stream (`XADD`/consumer group) for durability — **decision recorded in `DECISIONS.md`** (recommended: Redis Streams with a consumer group for at-least-once delivery + idempotent inserts keyed by `(driver_id, recorded_at)`).
7. **Deduplication/idempotency**: unique constraint on `(driver_id, recorded_at)`; `ON CONFLICT DO NOTHING` so replayed offline batches are safe.
8. **Stale/offline detection job**: a worker marks drivers with no fix for > `SIGNAL_LOST_SECONDS` as signal-lost, raises `SIGNAL_LOST` alert, and clears it on the next fix.
9. **History API** (DISPATCHER/ADMIN; DRIVER own only):
   - `GET /telemetry/drivers/:id/track?from=&to=&simplify=` returns GeoJSON `LineString` (via `ST_MakeLine` ordered by time) plus stats (distance, duration, avg/max speed); optional `ST_SimplifyPreserveTopology` / Douglas–Peucker for big ranges.
   - `GET /telemetry/drivers/:id/points?cursor=` paginated raw points.
10. **Metrics**: counters/histograms for accepted/rejected/filtered points, ingestion latency, buffer depth, flush duration (expose `/metrics` Prometheus-style, protected).
11. **Retention job**: drop/detach old partitions per policy (e.g. raw 30 days) and optionally downsample before deletion.

**Edge cases:** device clock wrong by minutes/hours (store both `recorded_at` and `received_at`, use `received_at` for staleness); GPS jitter while stationary (apply a stationary filter: if speed≈0 and displacement < accuracy, don't move the marker); tunnels/indoors producing accuracy spikes; duplicate batches; huge offline backlog arriving at once (process in chunks, back-pressure); Redis outage (degrade: write-through to DB queue, log loudly, recover).

**Tests:** unit tests for each validator/filter; property-style tests for the jump detector; integration test pushing 10k points and asserting counts, dedupe, and DB write batching; load test script (Phase 14) for sustained throughput.

**DoD:** Documented data contract; 10k+ points ingested with correct filtering/dedupe; DB write rate demonstrably batched; hot path latency measured and logged; history API returns correct track + stats.

---

### PHASE 9 — Real-Time Gateway (WebSockets)

**Goal:** Secure, scalable live data fan-out to dispatchers, drivers, and customers.

**Backend**

1. Socket.IO server attached to the HTTP server; Redis adapter for horizontal scaling.
2. **Handshake auth**: verify JWT; reject invalid; attach `{userId, role, driverId?}`; handle token expiry (client emits `auth:refresh`; server re-verifies, else disconnects).
3. **Rooms (authorisation by room membership)**:
   - `ops` — ADMIN/DISPATCHER: all driver positions, alerts, shipment events.
   - `driver:{id}` — that driver only: assignments, messages.
   - `shipment:{id}` — authorised customer/driver/dispatcher for that shipment.
   - `public:{trackingCode}` — public tracker (limited payload, see Phase 13).
     Join requests are validated server-side; never trust client-specified rooms.
4. **Event contract** (typed in `packages/shared/socketEvents.ts`):
   - Server→client: `driver:position`, `driver:status`, `shipment:updated`, `alert:created`, `alert:updated`, `zone:updated`, `system:notice`.
   - Client→server: `telemetry:update`, `telemetry:batch`, `subscribe:shipment`, `unsubscribe:shipment`, `ping`.
5. **Throttling/aggregation**: broadcast driver positions to `ops` at a capped rate (e.g. coalesce to latest per driver every 500–1000 ms) — dispatchers do not need every raw fix. Send **deltas**, compact payloads (short keys optional, numeric precision limited to ~6 decimals).
6. Initial state sync: on `ops` join, send a snapshot (latest positions from Redis) so the map is populated immediately; subsequent events are incremental.
7. Heartbeat/ping, connection limits per user, max payload size, per-socket event rate limits, graceful disconnect cleanup (set driver connection state, not necessarily offline).
8. Server-side sequence numbers per driver to let clients ignore stale/out-of-order messages.

**Frontend (`lib/socket`, `app/providers/SocketProvider`)**

- Singleton socket client with auth token injection, auto-reconnect with exponential backoff + jitter, status exposed to `ConnectionBanner` (connected / reconnecting / offline).
- `useSocketEvent` hook for typed subscriptions with cleanup; resubscribe rooms on reconnect; request a fresh snapshot on reconnect to heal gaps.
- Store live positions in a **Zustand store keyed by driverId** (mutable map + subscription by id) so only affected markers re-render — never replace a whole array on each message.

**Edge cases:** reconnect storms; duplicate listeners after hot reload; token refresh while connected; server restart mid-session; clients behind proxies that block WebSocket (allow long-polling fallback).

**DoD:** 200 simulated drivers broadcast to a dispatcher client with stable CPU/memory; unauthorised room join attempts rejected (tested); reconnect restores correct state via snapshot.

---

### PHASE 10 — Geofencing Engine & Alerts

**Goal:** Detect zone enter/exit and operational anomalies; deliver and manage alerts.

**Backend (modules `geofence`, `alerts`)**

1. Subscribe to `telemetry.received` (accepted, non-filtered fixes only).
2. For each fix, determine containing zones using the cached zone set + a fast pre-check (bounding box) then exact test (PostGIS `ST_Covers` for batches, or an in-process point-in-polygon library for the hot path — **decision recorded**; PostGIS remains the source of truth).
3. Compare with `GeofenceState` (Redis hash per driver) to detect **transitions** (outside→inside = ENTER, inside→outside = EXIT). Persist state changes; avoid duplicate alerts.
4. **Hysteresis/debounce** to defeat GPS jitter at boundaries: require N consecutive fixes (or a minimum buffer distance larger than the accuracy) before confirming a crossing.
5. Alert rules (configurable thresholds in DB/config):
   - `RESTRICTED_ZONE_BREACH` (critical) on entering a restricted zone.
   - `ZONE_EXIT` for a driver leaving their assigned delivery zone while on an active shipment.
   - `SIGNAL_LOST` (from Phase 8 job), `IDLE_TOO_LONG` (stationary > X min while `BUSY` and outside a depot/dropoff), `SPEEDING` (> limit sustained), `LOW_ACCURACY`, `SHIPMENT_DELAYED` (past ETA), `OFF_ROUTE` (raised from Phase 14A when a navigating driver stays off-route beyond a threshold; the alert enum value is added now, the producer arrives in Phase 14A).
6. Alert lifecycle: `OPEN → ACKNOWLEDGED → RESOLVED`; auto-resolve for conditions that clear (e.g., signal restored); dedupe window to prevent alert spam; severity levels with colours from theme tokens.
7. Endpoints: `GET /alerts` (filters/pagination), `POST /alerts/:id/acknowledge`, `POST /alerts/:id/resolve`, `GET /alerts/stats`.
8. Real-time: emit `alert:created/updated` to `ops`; optionally notify the affected driver (e.g. "You entered a restricted zone").
9. Depot logic: entering a depot zone with a shipment in `ASSIGNED` can auto-suggest `PICKED_UP`; arriving near dropoff radius auto-suggests `ARRIVED` (suggestion events, not forced transitions).
10. Audit: alert acknowledgement actions recorded.

**Frontend (`features/alerts`)**

- `AlertsBell` (count badge, dropdown), `AlertsPanel` (map side panel, severity filters, "locate on map"), `AlertsTable` page, `AlertToast` for critical alerts with sound toggle (user preference), acknowledge/resolve actions with optimistic UI.

**Edge cases:** driver starts inside a zone (initialise state without firing ENTER); overlapping zones; zone edited/deleted while drivers inside (recompute state); alert flapping at boundaries; time to acknowledge SLA indicator.

**Tests:** scripted simulated tracks crossing boundaries repeatedly with jitter — assert exactly the expected alert count.

**DoD:** Deterministic boundary-crossing test passes with zero duplicate alerts; alerts appear on the dispatcher UI within one telemetry cycle; lifecycle transitions covered.

---

### PHASE 11 — Dispatch & Assignment

**Goal:** Assign shipments to the best driver, with manual override.

**Backend (module `dispatch`)**

1. `GET /dispatch/suggestions?shipmentId=` returns ranked drivers: status `AVAILABLE`, vehicle capacity ≥ weight, within max radius of pickup, scored by distance (PostGIS `ST_Distance` or Redis `GEOSEARCH`), current workload, last-seen freshness (exclude signal-lost drivers), and optional zone match.
2. `POST /dispatch/assign` `{shipmentId, driverId}` → state machine `CREATED → ASSIGNED` in a transaction; push to `driver:{id}` room; handle driver already `BUSY`.
3. Driver actions: `POST /shipments/:id/accept`, `/reject` (with reason); reject returns the job to `CREATED` and triggers re-suggestion; **assignment timeout** job re-dispatches if not accepted in X minutes.
4. Auto-dispatch mode (optional toggle in settings): automatically assigns the top suggestion; fully audited.
5. Batch assignment: assign multiple shipments to one driver (route stops ordering by nearest-neighbour as a simple heuristic; interface left open for a real VRP solver).

**Frontend (`features/dispatch`)**

- `DispatchBoard` (columns by status, drag-to-assign optional), `AssignDriverModal` showing ranked suggestions with distance/ETA and a mini-map preview, unassigned queue with priority/age sorting, driver workload indicators.

**Edge cases:** no available drivers (clear empty state + retry/widen radius); driver goes offline between suggestion and assign (re-validate at assign time inside the transaction); two dispatchers assigning the same shipment simultaneously (row lock → second gets 409 with friendly message).

**DoD:** Suggestions verified against hand-computed distances in tests; race-condition test passes; driver receives the assignment in real time.

---

### PHASE 11A — Notifications, Real Email Delivery & Suspicious-Activity Alerts

**Goal:** Every important event reliably reaches the right people by **real email**, exactly once, with full traceability — and the admin is warned when accounts behave suspiciously.

> Build order note: the email _infrastructure_ (steps 1–8) is needed by Phase 4 for verification/reset emails, so build the provider, queue, templates and log **as soon as Phase 4 begins** (against Mailpit in dev), then add the shipment and security notifications here once shipments, dispatch and alerts exist.

#### A. Notification matrix (the contract — implement exactly this)

| #   | Event (domain event)                                                                 | Recipients                                                                                                                                                                                                                                                                                                        | Email content                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Parcel picked up** (`shipment.statusChanged` → `PICKED_UP`)                        | The shipment's **customer**                                                                                                                                                                                                                                                                                       | "Your package has been picked up" — tracking code, driver first name + vehicle type, pickup time, button linking to the tracking page                                                                                               |
| 2   | **Parcel inbound / on the way** (`→ IN_TRANSIT`)                                     | The **customer**                                                                                                                                                                                                                                                                                                  | "Your package is on its way" — current ETA, tracking link. Optional second email "arriving soon" when ETA < `ARRIVING_SOON_MINUTES` (config, default 10) — sent at most once per shipment                                           |
| 3   | **Parcel arrived at destination** (`→ ARRIVED`)                                      | The **customer**                                                                                                                                                                                                                                                                                                  | "Your package has arrived" — arrival time, address, tracking link. Optional (config flag) delivery-confirmation email on `→ DELIVERED`                                                                                              |
| 4   | **New request from a customer** (`shipment.requested`)                               | All active **dispatchers** (each gets one email, or one shared dispatch mailbox if configured) **and eligible drivers** — `AVAILABLE`, fresh GNSS fix, within `NEW_REQUEST_DRIVER_RADIUS_M` of the pickup, nearest `NEW_REQUEST_MAX_DRIVERS` only (all three are configurable; driver emailing can be turned off) | "New delivery request" — tracking code, pickup/dropoff addresses, weight, priority, requested time, button to the dispatch board (dispatchers) or the job list (drivers). Drivers are told it is an _invitation_, not an assignment |
| 5   | **Request cancelled by the customer** (`shipment.cancelled`, actor = customer)       | All active **dispatchers**, and the **assigned driver** if one was assigned                                                                                                                                                                                                                                       | "Request cancelled" — tracking code, reason given, state it was in, whether a driver had already been assigned/en route                                                                                                             |
| 6   | **Job assigned to a driver** (`shipment.assigned`)                                   | The assigned **driver**                                                                                                                                                                                                                                                                                           | "New job assigned" — pickup/dropoff, deadline, link to accept/reject                                                                                                                                                                |
| 7   | **Suspicious activity detected** (`security.event`, severity ≥ configured threshold) | All active **admins**                                                                                                                                                                                                                                                                                             | "Security alert" — what happened, which account, IP + approximate location, user agent, time, evidence summary, link to the security event page. Contains **no tokens, passwords or full coordinates**                              |
| 8   | Account emails                                                                       | The user themselves                                                                                                                                                                                                                                                                                               | Email verification, password reset, password-changed notice, new-device login notice, account-locked notice (these cannot be switched off)                                                                                          |

Cancellation by a dispatcher/admin (not the customer) notifies the customer and the assigned driver; this is a small extension of rows 5–6 and uses the same templates.

#### B. Email infrastructure (build once, used by everything)

1. **`EmailProvider` interface** (`send({to, subject, html, text, headers, idempotencyKey})` → `{providerMessageId}`) with these implementations:
   - `NodemailerSmtpProvider` — **the only real provider for now.** One Nodemailer transport over SMTP: Mailpit in development, your real SMTP credentials in staging/production (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, all validated by Zod at boot).
   - `ConsoleProvider` — unit tests only.
   - Selected by env (`EMAIL_PROVIDER=smtp|console`). The app **refuses to boot in production with `ConsoleProvider`**.
   - Use a **pooled** transport (`pool: true`, bounded `maxConnections` / `maxMessages`) and enable TLS; verify the connection at startup (`transporter.verify()`) and report it in `/health/ready`.
   - Hosted-API providers (Resend, SendGrid, SES, Postmark) are a **future swap**: add one new class implementing the interface and change `EMAIL_PROVIDER`. Nothing else changes. Do not build them now.
2. **Domain & deliverability:** send from a verified domain (`notifications@yourdomain`); configure **SPF, DKIM and DMARC**; separate `From` for security mail vs. shipment mail; `Reply-To` pointing at a monitored address; documented in `docs/EMAIL.md` with a DNS checklist. (Without this, real emails land in spam — treat it as a deliverable, not an afterthought.)
3. **Queue (BullMQ on Redis):** domain event → `notifications` service creates a `NotificationEvent` (with a unique `dedupe_key`) and enqueues one `email.send` job **per recipient**. Sending never happens inside the request/response cycle or inside a DB transaction.
4. **Exactly-once-per-event semantics:** `dedupe_key = {type}:{entityId}:{transitionVersion|eventId}:{recipientId}`; unique constraint + `ON CONFLICT DO NOTHING` means a replayed event, a retried job or a double-clicked button never produces a second email. Reaching the same status twice (e.g. a retry after `FAILED_DELIVERY`) uses the transition's own version/id, so each real transition still emails once.
5. **Retries & failure handling:** exponential backoff (e.g. 5 attempts: 30 s, 2 m, 10 m, 1 h, 6 h) for transient errors (network, 4xx rate limits, 5xx); **no retry** for permanent errors (invalid address, hard bounce) → mark `FAILED`/`SUPPRESSED`; a dead-letter queue + admin-visible failed list; the originating business action **never fails** because an email failed.
6. **Templates:** React Email or MJML, one layout shell using the brand tokens from the theme (logo, colours, typography), responsive, dark-mode friendly, tested in Mailpit; each template has an HTML part **and** a plain-text part; all dynamic values HTML-escaped; subject lines under ~60 characters; consistent footer (company, why you got this, preference link where allowed). Templates are typed (`TemplateName` → required variables) so a missing variable is a compile error.
7. **Recipient resolution** lives in `notifications/recipients.ts`: pure, unit-tested functions (`dispatchersToNotify()`, `driversNearPickup(shipment)`, `adminsToNotify()`, `customerOf(shipment)`). Only **active** users with a **verified** email are emailed (unverified customers get the verification email and a one-time reminder, nothing else).
8. **Suppression & bounces (SMTP-appropriate version):** plain SMTP gives no delivery webhooks, so for now:
   - Treat an SMTP rejection at send time (e.g. 5xx "mailbox does not exist") as a **permanent failure** and add the address to `EmailSuppression` (`HARD_BOUNCE`); the sender checks suppression before every send.
   - Optionally poll the sending mailbox over IMAP for asynchronous bounce (DSN) messages and feed them into the same suppression logic — a later enhancement, not required for the first version.
   - Admin can view/clear suppressions.
   - The signature-verified webhook endpoint (`POST /webhooks/email/:provider`) is **deferred until a hosted provider is added**; keep the `EmailSuppression` table and the sender check so that future change is small.
   - Because nothing confirms delivery beyond SMTP acceptance, the `EmailLog` status `SENT` means "accepted by the SMTP server", and the docs must say so.
9. **Preferences:** `GET/PUT /notifications/preferences` — users can disable non-critical emails per type (e.g. drivers can turn off "new request invitation"); **security and account emails are mandatory**. Customer shipment-status emails default ON.
10. **Rate limiting & protection:** per-recipient send cap (e.g. max N emails/hour/user) and a global circuit breaker so a bug or an attack cannot mail-bomb anyone; the public tracking and registration endpoints cannot be used to trigger arbitrary emails (verification resend is rate-limited per account and per IP).
11. **Privacy:** emails contain a **tracking link, not live coordinates**; driver is identified by first name only; no sensitive data in subjects; `EmailLog` stores recipient, template, status and provider id — **not** the rendered body.
12. **Observability:** metrics for queued/sent/failed/bounced, queue depth and send latency; structured logs with `notificationEventId`; `/health/ready` reports queue connectivity.

#### C. Suspicious-activity detection (module `security`)

The `security` module consumes `security.signal` events (Phase 4 step 11) plus a few signals from other modules, evaluates **explainable rules**, and writes a `SecurityEvent`. Events at or above the email threshold trigger notification #7.

| Rule                                | Detection logic (configurable thresholds)                                                                                                                                        | Severity                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Brute force / credential stuffing   | ≥ N failed logins for one account **or** from one IP across many accounts within a window (Redis sliding window)                                                                 | High                                                               |
| Account lockout                     | Lockout triggered (Phase 4)                                                                                                                                                      | Medium                                                             |
| Refresh-token reuse                 | A rotated refresh token is presented again (token theft indicator)                                                                                                               | Critical                                                           |
| New device / location login         | Login whose device fingerprint or IP-country has never been seen for this user                                                                                                   | Low (emails the user, not the admin) → Medium for privileged roles |
| Impossible travel                   | Two logins whose approximate locations imply a speed above a threshold (reuses the project's own distance logic)                                                                 | High                                                               |
| Privilege-escalation attempts       | A user repeatedly calling endpoints forbidden for their role, or any attempt to change their own role                                                                            | High                                                               |
| IDOR / enumeration probing          | Burst of 403/404 on object IDs the user does not own; sequential tracking-code guessing                                                                                          | High                                                               |
| Telemetry spoofing                  | A driver account repeatedly sending physically impossible fixes (jump detector from Phase 8), fixes for another driver's ID, or coordinates inconsistent with a connected device | High                                                               |
| Mass request creation               | A customer creating requests far above a normal rate, or many cancellations in a row                                                                                             | Medium                                                             |
| Credential-change bursts            | Email/password/phone changed repeatedly, or immediately after a new-device login                                                                                                 | High                                                               |
| Dormant/privileged account activity | Admin/dispatcher login at unusual hours or from a new country                                                                                                                    | Medium                                                             |

Rules of the road:

- **Admin email policy:** send immediately for `High`/`Critical`; roll `Medium` into a **digest** (hourly/daily, config); never email on `Low`. **Deduplicate/aggregate**: the same rule + same account + same window = one email with a count, not fifty.
- Every rule is a small, pure, unit-tested class with a documented rationale; thresholds live in config so they can be tuned without code changes.
- Automatic response is limited and reversible (temporary lockout, forced re-login/token revocation on `Critical`); no automatic permanent bans.
- Admin UI: `SecurityEventsTable` (filters by severity/type/user/status), `SecurityEventDetail` (evidence timeline), actions **Review / Dismiss / Lock account / Force logout / Reset password**, all audited.

#### D. API & frontend

**Endpoints:** `GET /notifications/preferences`, `PUT /notifications/preferences`; `GET /admin/email-log` (filters: status, type, recipient, date; admin only), `POST /admin/email-log/:id/retry`, `POST /admin/email/test` (sends a test email to the admin, used to verify the SMTP setup); `GET /admin/security-events`, `GET /admin/security-events/:id`, `PATCH /admin/security-events/:id` (review/dismiss). _(The provider webhook endpoint is deferred — see B.8.)_

**Frontend:** `NotificationPreferencesForm` (profile page), `EmailLogTable` and `SecurityEventsTable` (admin area, built from the shared `DataTable`), `SecurityEventDetailDrawer`, in-app badge for open security events on the admin top bar. Email templates are previewed in a dev-only `/__emails` route so design stays consistent with the theme.

**Edge cases:** customer with an unverified/bounced/suppressed address (skip, log reason, show a banner asking them to fix it); two transitions in quick succession (two separate emails, in order — queue concurrency per shipment of 1 or per-event ordering); shipment cancelled while emails for it are queued (cancellation email supersedes unsent "on the way" mail: check shipment state at send time and drop stale ones); provider outage (queue backs up, retries, nothing lost, admins alerted via metric); a driver with no email (skip + in-app notice only); dispatcher team with 50 members (batch-sending, respect provider rate limits); timezone in email text (use recipient's timezone or include UTC offset); duplicated shipment-status events from offline-sync replays (dedupe key prevents repeats); email sent for a rolled-back transaction (prevented by publish-after-commit).

**Tests:** table-driven test that **each row of the notification matrix** produces exactly the expected recipients and template; dedupe test (replay the same event 5×, assert 1 email); retry/permanent-failure tests with a fake provider; template snapshot tests (HTML + text); recipient-resolution unit tests including inactive/unverified/suppressed users; one integration test per suspicious-activity rule (feed signals → assert a single `SecurityEvent` + single admin email); webhook signature test; end-to-end test with Mailpit asserting a real SMTP message arrives with the correct links.

**DoD:** All eight matrix rows verified by automated tests **and** by a manual run that delivers real emails to a real inbox (with SPF/DKIM passing in the message headers); no duplicate emails under replay; admin receives a single, readable security email for each triggered rule; email log shows every send with status; killing the provider and restoring it results in all queued emails eventually delivered.

---

### PHASE 12 — Dispatcher Live Map (C2 Operational Picture)

**Goal:** The flagship screen: a performant, information-dense live map.

**Frontend (`features/map`, page in `MapLayout`)**

1. `MapCanvas` with base layers: **Satellite imagery (default for the demo)**, Streets, Dark; layer control component `BaseLayerSwitcher`; attribution handled per provider; tile URLs from env.
2. `DriversLayer`:
   - Marker per driver with status colour, heading rotation (arrow), and ring sized by `accuracy_m` (accuracy circle visible on select).
   - **Performance strategy**: use canvas rendering (`preferCanvas`) or a custom `L.Canvas`-based marker layer for large counts; marker clustering (`leaflet.markercluster`) with `chunkedLoading`; update marker positions **imperatively** from the Zustand store (no React re-render per update); smooth movement via animated interpolation between fixes (`requestAnimationFrame`, ≤ 1 s), skipped when the tab is hidden.
   - Stale driver styling (greyed + "last seen 3m ago") and signal-lost indicator.
3. `ShipmentsLayer`: pickup/dropoff pins, selected shipment highlight. For a driver with an active navigation session, show the **planned route polyline** (from Phase 14A, streamed over the `ops` room), the next maneuver, remaining distance and a live ETA; fall back to a straight line from driver → dropoff only when no route exists. Off-route drivers get a distinct marker state.
4. `ZonesLayer` (toggle), `TrailLayer` (recent trail per selected driver, last N minutes from store, fading polyline), optional `HeatLayer` (historic density).
5. Side panels (floating, collapsible, remember state):
   - Left: searchable/filterable list of drivers & shipments (status, zone, vehicle type); click → fly to + select.
   - Right: `DriverDetailPanel` (status, vehicle, speed, heading, accuracy, last fix time, current shipment, quick actions: assign, message, view history).
   - Top-centre: KPI strip (active drivers, in-transit, unassigned, open alerts).
6. Map UX: fit-to-fleet, follow-selected-driver toggle, measure-distance tool, coordinate readout (`font-data`) on cursor, copy coordinates, keyboard shortcuts, fullscreen.
7. Visibility handling: viewport-based culling/updates; pause heavy animation when the tab is hidden; debounce map-move-driven queries.
8. Fallbacks: tile load failure handling with retry/next provider; empty/loading skeleton overlays; connection banner when sockets drop (markers dim until resynced).

**Edge cases:** thousands of markers (benchmark and document the limit); two markers at identical coordinates (spiderfy); marker memory leaks on unmount (cleanup tested); out-of-order or stale messages (sequence guard); dateline/zoom limits; high-DPI tiles.

**DoD:** 200 live drivers at 1 Hz updates stays ≥ 55 fps on a mid-range laptop (documented measurement); selecting/following/filtering work with no console errors; React Profiler shows no per-message re-render of the whole map tree.

---

### PHASE 13 — Customer Tracking & Public Tracking Page

**Goal:** Let customers (authed) and anyone with a code (public) follow a parcel safely.

**Backend (module `tracking`)**

1. `GET /tracking/:trackingCode` (public, rate-limited, no auth): returns status, timeline (non-sensitive), ETA, and the **driver's approximate location only while status is `PICKED_UP/IN_TRANSIT/ARRIVED`**; location may be **rounded/delayed** (privacy mode config) and never exposes driver identity beyond first name/vehicle type.
2. Public socket room `public:{trackingCode}` with a throttled, minimal payload.
3. Abuse protection: strict rate limit per IP, constant response shape for unknown codes (no enumeration hints), bot-friendly caching headers where safe.
4. Customer-authenticated variant provides richer detail for their own shipments.

**Frontend (`features/tracking`, `PublicLayout`)**

- `TrackingSearch`, `TrackingMap` (single driver + route to dropoff), `StatusStepper` (timeline), `EtaCard`, `DriverCard` (limited), auto-refresh via socket with polling fallback, friendly "not found"/"delivered" states, shareable URL.

**Edge cases:** parcel delivered → location hidden and map shows final dropoff only; driver temporarily offline → show "last updated X ago"; invalid/expired codes; mobile data usage (light payloads).

**DoD:** Public page leaks no PII (reviewed + tested); enumeration attempts rate-limited; works on a 360 px viewport.

---

### PHASE 14 — Driver Application (Mobile-First PWA) & Offline Resilience

**Goal:** A driver client that captures GNSS data, survives connection loss, and syncs safely.

**Frontend (`features/telemetry`, `DriverLayout`)**

1. **Screens**: Jobs (assigned/active), Job Detail (actions: accept/reject, picked up, in transit, arrived, delivered/failed with note/photo-placeholder, and a **"Start navigation"** button that opens the Phase 14A navigation screen), Map (self + zones; the full navigation experience is built in Phase 14A), Status (available/break/offline), Profile.
2. **GNSS capture hook** `useGnssTracker`:
   - Uses `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`, sensible `maximumAge`/`timeout`.
   - Handles permission states (prompt/granted/denied) with a clear onboarding screen and instructions for re-enabling.
   - Throttles by time **and** distance (e.g., send when ≥ 2 s and moved ≥ 5 m, or every 15 s heartbeat when stationary) to conserve battery/data.
   - Adaptive sampling: lower frequency when stationary/low battery.
   - Shows live GNSS quality indicator (accuracy bands: good/fair/poor) and satellite-signal status strip.
   - Wake Lock API to keep the screen on while on shift (with fallback messaging).
3. **Offline queue**: persist unsent fixes and shipment actions in **IndexedDB** (e.g. via `idb`), ordered, with ids/idempotency keys. On reconnect, flush in chronological batches via `POST /telemetry/batch` and `Idempotency-Key` on transitions; mark synced; cap queue size with oldest-point downsampling policy; visible "N updates pending" badge.
4. Connection handling: online/offline events + socket status; automatic switching between socket stream and HTTP batch fallback; exponential backoff.
5. PWA: manifest, icons, service worker (app shell caching, runtime caching of map tiles for the working area with size limits), install prompt. Background Sync where supported (documented as best-effort; no reliable background GPS in browsers — state this limitation honestly in docs).
6. Safety/UX: large touch targets, high-contrast theme, minimal text while driving, confirmations for destructive actions.

**Backend additions:** `POST /telemetry/batch` hardened for large backlogs; per-driver idempotent insert verified.

**Edge cases:** permission revoked mid-shift; GPS unavailable (indoors) → show warning, keep last known, flag stale; device clock drift (send both device time and monotonic offsets; server computes received skew); tab backgrounded/throttled timers; battery saver mode; double-tap on action buttons (disable while pending + idempotency).

**Tests:** simulate offline for N minutes in Playwright (toggle network), assert queue growth then complete, ordered, de-duplicated sync with zero loss; unit tests for throttle/distance filter logic.

**DoD:** Offline → online sync demo works end-to-end with zero data loss and correct ordering; GNSS quality UI reflects real accuracy values; PWA installable.

---

### PHASE 14A — Real-Time Turn-by-Turn Navigation Engine

**Goal:** A driver taps "Start navigation" and gets live, spoken and visual turn-by-turn guidance along a road-snapped route, with automatic off-route detection and rerouting. Dispatchers see the same route, progress and ETA live; customers get better ETAs.

**What "engine" means here (be explicit in docs):** the _road graph search_ (computing the best route and producing maneuvers) is delegated to a proven open-source engine (Valhalla recommended). The _navigation engine_ we build is everything that makes it real-time guidance: route normalisation, snapping GNSS fixes to the route, progress tracking, instruction timing, off-route detection, rerouting, ETA tracking, voice, and dispatcher/customer fan-out. That is the part that demonstrates GNSS-data skill.

#### A. Routing infrastructure

1. Add the `valhalla` service to Docker Compose with a mounted **OpenStreetMap extract of the demo region** (Geofabrik `.osm.pbf`); build routing tiles on first start; document the data-update procedure and RAM/disk needs in `docs/ROUTING.md`. Show OpenStreetMap attribution (ODbL) in the app.
2. **`RoutingProvider` interface** in `modules/navigation`: `route({waypoints, costing, excludePolygons, alternatives, language})`, `matchTrace({points, costing})`, `health()`. Implement `ValhallaProvider`; optionally `OsrmProvider`; plus `FakeProvider` (fixtures) for tests. **The rest of the system never sees provider JSON** — it is normalised into our own types in `packages/shared`: `Route { geometry, legs[], distanceM, durationS }`, `Step { index, type, instruction, verbalAlert, verbalPre, verbalPost, streetNames[], distanceM, durationS, beginShapeIndex, endShapeIndex, bearingBefore, bearingAfter, roundaboutExit? }`.
3. **Costing by vehicle type** (from the driver's vehicle): `BIKE` → bicycle/scooter, `CAR` → auto, `VAN`/`TRUCK` → truck (pass dimensions/weight from `Vehicle` when available).
4. **Avoid restricted zones:** pass every active `RESTRICTED` zone (Phase 6) as an exclude-polygon so generated routes do not cross them. If no route exists without crossing, return the best route **flagged** `crossesRestrictedZone: true` and require dispatcher confirmation.
5. Resilience: request timeouts, circuit breaker, short-TTL cache for identical route requests, and a **degraded mode** when the engine is down (straight-line guidance: bearing + distance to destination, clearly labelled "road routing unavailable"). Coordinates outside engine coverage → clear 422 error.

#### B. Backend (module `navigation`)

1. Endpoints:
   - `POST /navigation/routes` (preview a route between points; DRIVER/DISPATCHER/ADMIN; rate-limited)
   - `POST /navigation/sessions` `{ shipmentId }` — DRIVER only, only for **their own** active shipment; builds waypoints (current position → pickup if not yet picked up → dropoff, plus further stops for batched jobs), computes the route, stores a `NavigationSession`, returns the full normalised route
   - `GET /navigation/sessions/active/me` (resume after app reload)
   - `POST /navigation/sessions/:id/reroute` `{ position, heading, accuracyM, reason }` — returns a new route from the driver's current position to the remaining waypoints; **single-flight** per session, minimum interval between reroutes, increments `reroute_count`
   - `POST /navigation/sessions/:id/progress` (throttled, ~every 5 s): `{ stepIndex, remainingDistanceM, etaSeconds, offRoute }` — stored in Redis (not Postgres) and broadcast
   - `POST /navigation/sessions/:id/end` `{ reason: ARRIVED|CANCELLED|MANUAL }`
   - `GET /navigation/sessions/:id` (dispatcher/admin; driver own)
2. Real-time: socket events `navigation:route` (planned route for `ops` + `shipment:{id}` rooms), `navigation:progress`, `navigation:offRoute`, `navigation:rerouted`, `navigation:ended`. The **public tracking page gets only ETA and remaining distance**, never the route geometry.
3. Domain events emitted: `navigation.offRoute`, `navigation.arrived`, and `navigation.eta` (rate-limited, only on meaningful change). These feed: updating `shipment.eta` (Phase 7), the optional **"arriving soon" email** (Phase 11A row 2), an alert if a driver stays off-route too long (Phase 10 `OFF_ROUTE` alert type — add it to the enum), and "suggest `ARRIVED`" (Phase 10 step 9).
4. Authorisation & integrity: a driver may only start/reroute/end **their own** session; progress reports are validated (step index in range, monotonic within tolerance); a session is cancelled automatically if its shipment is cancelled/reassigned (Phase 7 step 9) or the driver goes `OFFLINE`.
5. Persist the route and key events (`session started`, `off route`, `rerouted`, `arrived`) so Phase 16 replay can show the planned vs. driven path.

#### C. Navigation core (pure TypeScript, framework-free, deterministic) — `packages/shared/navigation`

Built as a plain class (`NavigationEngine`) fed with fixes and a clock, returning a state object. **No DOM, no React, no network inside it** — so the same code runs in the browser, in the simulator and in unit tests.

1. **Route preparation:** decode geometry, build a cumulative-distance array and per-segment bearings once.
2. **Fix filtering:** ignore fixes with `accuracy_m` above the navigation threshold for progress (still shown on the map as raw), apply light smoothing (EMA or small Kalman filter), drop fixes that fail the Phase 8 jump test, and use speed/heading only when speed is above a minimum (heading from a stationary phone is noise).
3. **Snapping & progress along route:** project the fix onto route segments **within a forward-biased window around the last known progress** (never scan the whole route — this prevents jumping to a parallel/overlapping road segment); disambiguate with heading vs. segment bearing; progress is **monotonic** (small backward tolerance for jitter). Output: `distanceAlongRoute`, `lateralOffsetM`, `snappedPosition`, `currentStepIndex`, `distanceToNextManeuverM`, `remainingDistanceM`.
4. **Instruction timing:** each step has announcement tiers scaled by speed — an early alert (≈ 15–20 s ahead, min ≈ 300 m on fast roads), a pre-transition (≈ 100–200 m), and "now" (≈ 30 m) using the provider's verbal strings. **Each tier fires exactly once per step**; tiers are skipped if the driver is already past them (e.g. short steps in a row are merged into one "turn left, then turn right" announcement). Reset correctly after rerouting.
5. **Off-route detection (with hysteresis):** declare off-route only when lateral offset exceeds `max(OFF_ROUTE_MIN_M, k × accuracy_m)` for **K consecutive good fixes or T seconds**, or when moving fast in a direction clearly opposite the route. Do not declare off-route while accuracy is poor, while stationary, or within a few seconds of a maneuver (GNSS lags at turns). Hysteresis to return to `ON_ROUTE` (e.g. back within a tighter band for 2 fixes).
6. **Dead reckoning for short gaps** (tunnels/urban canyon): when no usable fix arrives, advance along the route using last good speed for up to `DEAD_RECKON_MAX_S`, mark state `ESTIMATED`, and snap back when a good fix returns; never dead-reckon past a maneuver silently — freeze and show "searching for GPS" instead.
7. **Arrival & legs:** intermediate waypoint reached when within `ARRIVAL_RADIUS_M` and speed is low (or the final step completes) → advance to the next leg and announce it; final arrival → state `ARRIVED` and a suggestion to mark the shipment `ARRIVED` (driver confirms; never auto-transitions).
8. **ETA:** remaining duration from step durations, scaled by a smoothed ratio of observed-to-expected speed (clamped, e.g. 0.6–1.6) so ETA reflects how the driver is actually moving; reported with a confidence flag when data is poor.
9. **State machine for the session:** `IDLE → ON_ROUTE ↔ OFF_ROUTE → REROUTING → ON_ROUTE → ARRIVED`, plus `GPS_LOST/ESTIMATED` as an orthogonal flag. Transitions are explicit and unit-tested.

#### D. Frontend (`features/navigation`, inside `DriverLayout`)

Components (all built from `components/ui` primitives and theme tokens):

- `NavigationScreen` (page composition), `NavigationMap` (map with follow mode), `RouteLayer` (route casing + fill, **driven portion greyed**, waypoint pins), `SnappedDriverMarker` (arrow, rotates with heading, smoothly interpolated), `NextTurnBanner` (large maneuver icon, distance, street name), `ThenInstruction` (the following maneuver, shown when close), `EtaBar` (ETA clock time, remaining distance/time), `VoiceToggle` (mute/unmute, volume), `RecenterButton`, `OverviewToggle`, `ReroutePrompt` ("Rerouting…" / "Route updated"), `GpsQualityBadge` (reuses the Phase 14 indicator), `EndNavigationDialog`, `ArrivalSheet` (arrival confirmation → mark Arrived).
- **State:** a `navigationStore` (Zustand) holding the engine output; the engine runs in the client so guidance continues through brief connectivity loss; the store pushes throttled progress to the server.
- **Map behaviour:** follow-driver with **heading-up rotation** (Leaflet has no native rotation — use a rotation plugin such as `leaflet-rotate`, or rotate the map pane with CSS, and verify marker/tooltip behaviour; decision recorded in `DECISIONS.md`), look-ahead offset so the driver sits in the lower third of the screen, speed-based zoom, smooth `requestAnimationFrame` interpolation between fixes, pause animation when the tab is hidden, manual pan disables follow until "Recenter" is tapped (and auto-resumes after N seconds).
- **Voice:** Web Speech API (`speechSynthesis`) with a **user gesture on "Start navigation"** to unlock audio on mobile browsers; an announcement queue that never overlaps or replays stale instructions (cancel the queue on reroute); language/voice selection from available system voices; a short chime fallback and always-on visual instruction when speech is unavailable or muted.
- **Offline:** route + steps are cached in IndexedDB at session start, so guidance continues without a connection; rerouting needs the network — when offline show "No connection — follow the previous route / return to route" and queue the reroute request; telemetry keeps queueing as in Phase 14.
- **Dispatcher side:** the Phase 12 map shows the planned route, next maneuver, progress and live ETA for the selected driver; an "off route" badge appears on the driver marker.
- **Safety UX:** minimal interaction while moving (large targets, no text entry), high-contrast day/night style that follows the theme, confirmation required to end navigation, a clear note in docs that this is a driver aid and not certified navigation software.

#### E. Edge cases

GNSS jitter at standstill (no phantom progress or off-route); parallel roads and service roads next to highways (heading + forward window); U-turns and loops where a route crosses itself (monotonic progress + window); roundabouts (exit-count instructions, don't declare off-route while circling); very short consecutive steps (merge announcements); tunnels and underpasses (dead reckoning, then snap back); route start when the driver is not yet on a road (snap to nearest road / walk-to-road segment); destination not reachable by road (error + dispatcher notification); one-way or closed roads missing from the OSM extract (reroute loops → cap reroutes, e.g. > 5 in 2 min ⇒ alert dispatcher and show "check route"); stale or out-of-order fixes after offline sync (ignore for guidance, keep for history); speech unavailable/blocked; engine slow or down mid-trip (keep current route, degraded mode if none); shipment cancelled or reassigned mid-navigation (session ends gracefully with a spoken/visual notice); driver changes vehicle type mid-shift (reroute with new costing).

#### F. Tests

- **Unit (engine):** projection math and cumulative distances; monotonic progress; each announcement tier fires once; off-route hysteresis with injected jitter (no false positives on a noisy on-route track, detection within K fixes on a real deviation); reroute single-flight and rate limiting; dead-reckoning enter/exit; leg advance and arrival; ETA scaling bounds; roundabout and U-turn fixtures.
- **Contract:** `ValhallaProvider` normalisation against recorded real responses (fixtures committed), plus a live smoke test against the Compose service in CI.
- **Integration:** session lifecycle endpoints with role/ownership matrix; restricted-zone avoidance returns a route that does not intersect the zone (PostGIS assertion); cancel-shipment ends the session.
- **Simulation/E2E:** the Phase 15 simulator **drives along a generated route** (with noise, a forced wrong turn and a tunnel gap) and Playwright asserts instructions appear in order, the off-route state triggers, the reroute arrives, and arrival is detected.
- **Manual field check:** one real drive/walk test on a phone (documented results), because browsers throttle GNSS and timers in the background.

**DoD:** Following a simulated drive yields correct, correctly-timed instructions (visual + voice) with no repeated or missed maneuvers; a forced wrong turn is detected within the configured number of fixes and a new route is applied without UI glitches; dispatcher sees route, progress and ETA live; customer ETA/"arriving soon" email uses navigation ETA; restricted zones are avoided or flagged; engine outage degrades gracefully; `docs/ROUTING.md` and `docs/NAVIGATION.md` written, including the live-traffic limitation.

---

### PHASE 15 — Telemetry Simulator & Demo Data

**Goal:** Make the project demonstrable anywhere, anytime, without real drivers.

**Steps**

1. CLI (`apps/api/src/scripts/simulator.ts`, `npm run sim -- --drivers 200 --speed 1x`) that:
   - Authenticates as a simulation credential; spawns N virtual drivers with vehicle-appropriate speeds.
   - Generates realistic paths by **requesting real routes from the routing engine (Phase 14A)** between depot, pickup and dropoff and driving along the returned geometry at vehicle-appropriate speeds (smoothed random walks only as a fallback when the engine is unavailable). Supports `--scenario wrong-turn` (deliberately leaves the route to exercise off-route detection and rerouting) and a tunnel gap (no fixes for N seconds).
   - Can also act as a **navigation client**: follows the instructions produced by `NavigationEngine` so full navigation flows can be demonstrated and tested headlessly.
   - Emits GNSS-like fixes with **noise** (Gaussian position jitter scaled by accuracy), **accuracy variation** (urban canyon spikes), **drift**, **speed/heading derived from movement**, occasional **signal dropouts** (offline queue + burst resend), occasional **bad fixes** (jumps, null island, future timestamps) to prove validation works.
   - Optionally drives shipments through their state machine (assign → accept → pickup → deliver) to animate dispatch screens.
   - Scenario flags: `--scenario restricted-breach`, `--scenario signal-loss`, `--scenario rush-hour`.
2. Time controls: speed multiplier, pause/resume, deterministic seed for reproducible demos.
3. Replay mode: ingest a recorded GPX/GeoJSON track as a driver (shows ability to read standard satellite-track formats — include a small GPX parser module with tests).
4. Data import/export: export track as GPX/GeoJSON from the history API.

**DoD:** One command produces a lively, believable demo; each scenario deterministically triggers its expected alerts; GPX import/export round-trips correctly.

---

### PHASE 16 — History, Replay & Analytics

**Goal:** After-action review and operational insight.

**Backend (module `analytics`)**

1. Endpoints (DISPATCHER/ADMIN): `GET /analytics/overview` (counts by status, on-time %, avg delivery time, active fleet), `GET /analytics/drivers/:id/performance`, `GET /analytics/zones/heatmap?from=&to=` (aggregated via `ST_SnapToGrid`/`ST_HexagonGrid`), `GET /analytics/shipments/timeseries`.
2. Use materialised views or pre-aggregation jobs for heavy queries; indexes verified with `EXPLAIN`.
3. Replay data: `GET /replay?from=&to=&driverIds=` returns time-bucketed positions for efficient scrubbing (server-side downsampling, max points per request). When a navigation session existed, also return the **planned route and key navigation events** (off-route, reroute, arrival) so the replay can show planned vs. driven path.
4. Optional **snapped history**: run stored tracks through the routing engine's map-matching (`matchTrace`) to produce a road-snapped version for cleaner distance/analytics figures; always keep and offer the raw track too.

**Frontend (`features/analytics`, replay in `MapLayout`)**

- Dashboard page: `StatCard`s, charts (lightweight library, themed with tokens), top drivers table, delivery time distribution.
- **Replay controls**: timeline scrubber, play/pause, speed (1×–60×), driver selection, track polyline with progress, event markers (alerts, status changes) on the timeline.
- Heatmap layer toggle; date range picker; export CSV/GPX/GeoJSON.

**Edge cases:** huge ranges (enforce limits + progressive loading); drivers with sparse data (interpolate visually, don't invent data silently — show gaps); timezone boundaries on daily aggregates.

**DoD:** Replay of a recorded simulated shift matches stored data; analytics numbers verified against SQL checks in tests.

---

### PHASE 17 — Optional Enhancements (only after all above are DONE)

- **Live-traffic-aware routing and ETAs** (requires a traffic data source or a commercial routing API behind the existing `RoutingProvider`; the base navigation engine in Phase 14A is already built).
- Advanced GNSS filtering beyond the basic smoothing used in Phase 14A (full Kalman/IMM filter using speed and heading, documented, tested, toggleable).
- Lane guidance and speed-limit display in the navigation screen (if the routing data supports it).
- Multi-vehicle route optimisation (vehicle-routing-problem solver) to replace the nearest-neighbour stop ordering from Phase 11.
- SMS and web-push channels alongside email (the notification matrix and queue from Phase 11A are channel-agnostic by design).
- Satellite imagery overlays from NASA GIBS (time-aware layers) as an analytic overlay.
- Multi-tenant organisation support.
- Rate-limited public API keys for third-party tracking.
- Proof-of-delivery (signature/photo) upload with object storage.

---

### PHASE 18 — Security Hardening

**Goal:** Defence in depth, verified.

**Checklist (each item gets a test or documented verification)**

1. **OWASP Top 10 pass**: injection (all SQL parameterised; no string-built queries), broken access control (object-level checks), cryptographic failures (TLS everywhere in prod, secrets from env/secret manager), insecure design, misconfiguration (Helmet, strict CORS allow-list, no debug in prod), vulnerable components (`npm audit` in CI, Dependabot), authentication failures (lockout, rotation), SSRF (no user-supplied URLs fetched server-side; allow-list for geocoder/tile providers), logging failures (audit trail, no sensitive data in logs).
2. Input hardening: Zod everywhere, size limits, content-type enforcement, HPP, NoSQL/SQL operator rejection, output encoding (React escapes by default; never `dangerouslySetInnerHTML`).
3. Transport/headers: HSTS, CSP (tight, with allowed tile/CDN hosts), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (geolocation only on driver origin routes).
4. Rate limiting tiers: global, auth, telemetry, public tracking — Redis-backed.
5. Data protection: location data is sensitive — minimise retention, restrict access by role, encrypt DB volume/at-rest in deployment docs, redact coordinates in logs (log only IDs/metrics), configurable privacy mode for public tracking.
6. Secrets & config: no secrets in repo; rotate JWT secrets procedure documented; separate secrets per environment.
7. Dependency/container security: minimal base images, non-root user, read-only filesystem where possible, image scanning in CI.
8. Security tests: dedicated suite for authz matrix, IDOR attempts, JWT tampering, token reuse, rate limit enforcement, SQLi/XSS payload fuzz on key endpoints.
9. **Email & notification security:** prevent email-header injection (never put user input in headers; use the provider SDK's structured fields), escape all template variables, use single-use hashed expiring tokens for verification/reset links with no secrets in query strings that get logged, make reset/verify responses non-enumerating, rate-limit anything that can trigger an email (register, resend, forgot-password, shipment requests), verify webhook signatures, keep SPF/DKIM/DMARC passing, and make sure security-alert emails never contain tokens, passwords or full coordinates. Test each of these.
10. **Navigation & routing security:** routing-engine endpoints are internal-only (never exposed publicly or proxied raw to the browser), route requests are rate-limited and size-limited (waypoint count, distance), session endpoints enforce driver ownership, progress reports are validated, the public tracking page never receives route geometry, and routing/geocoding hosts are on the SSRF allow-list.
11. **Suspicious-activity pipeline review:** verify every rule in Phase 11A with a replayed attack scenario, confirm thresholds are configurable, confirm automatic responses are reversible, and confirm the admin email is deduplicated.
12. Write `docs/SECURITY.md` with threat model (assets, actors, trust boundaries, mitigations) — frame it like a C2 system threat model for the interview.

**DoD:** Security suite green in CI; `docs/SECURITY.md` complete; no high/critical `npm audit` findings.

---

### PHASE 19 — Performance, Reliability & Observability

**Goal:** Prove it scales, and that you can show it.

**Steps**

1. **Load testing** (k6/Artillery): simulate 500–1000 concurrent socket drivers at 1 Hz; record p50/p95/p99 ingest→broadcast latency, DB write rate, Redis memory, CPU. Store results in `docs/PERFORMANCE.md` with charts.
2. Database: `EXPLAIN ANALYZE` for all spatial queries; connection pool tuning; verify partitioning and retention jobs; vacuum/analyze settings notes.
3. Frontend: bundle analysis, route-level code splitting, lazy-load heavy map plugins, image/tile caching, memoization where profiling proves benefit, Lighthouse and React Profiler reports.
4. Reliability: chaos checks — kill Redis, kill DB, restart API mid-stream; document and verify graceful degradation and recovery.
5. Observability: structured logs with request/driver correlation IDs, `/metrics`, optional Grafana dashboard JSON (ingest rate, buffer depth, socket count, alert rate, error rate), health checks wired to Compose healthchecks.

**DoD:** Performance doc with real numbers; documented recovery behaviour for each dependency failure; dashboards or metrics screenshots included.

---

### PHASE 20 — Testing Strategy Consolidation & CI/CD

**Targets**

- Unit: services, state machine, validators, geo helpers, GNSS filters — **≥ 80% line coverage on core logic**.
- Integration: every endpoint with real PostGIS/Redis (Testcontainers), role matrix.
- Realtime: socket auth, room isolation, throttling, reconnect snapshot.
- Frontend: component tests for primitives/features, hook tests for GNSS/offline queue, MSW-mocked API.
- E2E (Playwright): login per role; dispatcher assigns shipment and sees live movement; driver completes delivery; offline sync; customer public tracking; zone drawing.
- Geo-specific: golden tests for point-in-polygon, distance, lng/lat order, boundary hysteresis.
- Notifications: matrix-driven tests for every email type and recipient set, dedupe/replay, retry and permanent-failure handling, template snapshots, and an SMTP end-to-end test against Mailpit.
- Security pipeline: one scenario test per suspicious-activity rule asserting exactly one `SecurityEvent` and one admin email.
- Navigation: engine unit tests (progress, announcement tiers, off-route hysteresis, dead reckoning, ETA), provider contract tests against recorded fixtures, and a simulator-driven E2E run with a forced wrong turn.
- E2E additions: customer creates a request → dispatcher and nearby driver emails appear in Mailpit; customer cancels → dispatcher and assigned driver emails; status transitions → customer emails; driver starts navigation and is rerouted after a wrong turn.

**CI pipeline:** install → lint → typecheck → unit → integration → build → E2E (against Compose) → security audit → upload coverage/artifacts. Protect `main` (required checks).

**CD (documented, optional deploy):** Docker images built per app; migrations run as a pre-deploy step; zero-downtime strategy notes; environment promotion (dev → staging → prod); rollback procedure.

**DoD:** Green pipeline on a clean clone; coverage report published; E2E passes headless.

---

### PHASE 21 — Documentation & Interview Readiness

**Execution note (2026-11-19):** The user asked to start this phase ahead of phases 14–20 because of time constraints. Prepare docs and interview material from the current repository, state open verification honestly, and leave the original checklist/order status intact. Return to phases 14–20 later. Phase 21 remains open until its remaining artifacts and demo definition of done are actually met.

**Deliverables**

1. `README.md`: what it is, screenshots/GIFs (live map, geofence alert, offline sync, replay), quick start (`docker compose up`, seed, simulator), architecture diagram, tech stack, credentials for demo roles.
2. `docs/ARCHITECTURE.md`: module map, data flow diagram (device → ingestion → Redis → socket → map; Redis stream → Postgres), sequence diagrams for auth refresh, telemetry ingest, geofence alert, offline sync.
3. `docs/TELEMETRY.md`: GNSS data contract, quality filtering rules, why accuracy matters.
4. `docs/SPATIAL_QUERIES.md`: key PostGIS queries with `EXPLAIN` evidence.
5. `docs/SECURITY.md`, `docs/PERFORMANCE.md`, `docs/DECISIONS.md` (ADR log), `docs/API.md` (OpenAPI export), `docs/FRONTEND_GUIDE.md`, **`docs/EMAIL.md`** (provider setup, DNS records for SPF/DKIM/DMARC, notification matrix, retry/dedupe design, how to test with Mailpit), **`docs/ROUTING.md`** (OSM extract, Valhalla setup, updating data, costing, limitations), **`docs/NAVIGATION.md`** (engine design, state machine, thresholds and how to tune them, live-traffic limitation).
6. `docs/DEMO_SCRIPT.md` — a **5-minute walkthrough**:
   - 0:00–0:45 Framing: "A logistics platform whose core is real-time spatial data engineering" + architecture slide.
   - 0:45–2:00 Dispatcher live map (satellite layer), 200 moving assets, filtering, selecting a driver.
   - 2:00–3:00 Geofence: simulator triggers restricted-zone breach → alert appears → acknowledge.
   - 3:00–3:45 Driver offline → queue builds → reconnect → ordered sync, zero loss.
   - 3:45–4:30 Under the hood: PostGIS query + `EXPLAIN`, Redis hot path, batched writes, JWT rotation + RBAC.
   - 4:30–5:00 Replay + analytics, and how it maps to C2 / defense use cases.
   - _Extended (8-minute) version adds:_ a customer request landing as real emails to a dispatcher and driver; the driver starting turn-by-turn navigation, taking a wrong turn and being rerouted while the dispatcher watches the route and ETA update; and a simulated brute-force attack producing a single deduplicated security email to the admin.
7. Talking points ready for the four engineering highlights: geospatial DB optimisation, real-time pipeline, defensive API security, state management and map performance.
8. Record a short demo video and keep a seeded, one-command environment.

**DoD:** A reviewer can clone, run one command, and see the system working with the simulator within 5 minutes.

---

## 8. Order Summary (Build Sequence at a Glance)

| #   | Phase                                                      | Why this position                                                                                                      |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0   | Setup & tooling                                            | Everything depends on a stable base                                                                                    |
| 1   | **Frontend theme, layouts, UI primitives**                 | Consistency locked in before any feature screen                                                                        |
| 2   | Database (PostGIS)                                         | Schema is the backbone                                                                                                 |
| 3   | Backend core                                               | Shared infrastructure for all modules                                                                                  |
| 4   | Auth & RBAC                                                | Every later endpoint needs it                                                                                          |
| 5   | Vehicles & drivers                                         | Entities required by shipments/telemetry                                                                               |
| 6   | Zones                                                      | Needed by geofencing and dispatch                                                                                      |
| 7   | Shipments & state machine                                  | Core business logic                                                                                                    |
| 8   | Telemetry ingestion                                        | The satellite-data heart of the project                                                                                |
| 9   | Real-time gateway                                          | Delivers telemetry to clients                                                                                          |
| 10  | Geofencing & alerts                                        | Builds on telemetry + zones                                                                                            |
| 11  | Dispatch                                                   | Builds on drivers + live positions                                                                                     |
| 11A | **Notifications, real email & suspicious-activity alerts** | Needs shipments, dispatch and alerts; its email _infrastructure_ is started during Phase 4 for verification/reset mail |
| 12  | Dispatcher live map                                        | Integrates everything visually                                                                                         |
| 13  | Customer/public tracking                                   | Reuses realtime + shipments                                                                                            |
| 14  | Driver PWA + offline                                       | Real telemetry source + resilience                                                                                     |
| 14A | **Turn-by-turn navigation engine**                         | Needs telemetry, realtime, shipments, zones and the driver app; its routing service can be stood up earlier            |
| 15  | Simulator & demo data                                      | Enables demos and load tests (and drives real routes from 14A)                                                         |
| 16  | History, replay, analytics                                 | Value on top of stored data                                                                                            |
| 17  | Optional enhancements                                      | Only if time remains                                                                                                   |
| 18  | Security hardening                                         | Verified, not assumed                                                                                                  |
| 19  | Performance & observability                                | Evidence for claims                                                                                                    |
| 20  | Testing/CI consolidation                                   | Quality gate                                                                                                           |
| 21  | Documentation & interview prep                             | Packaging the story                                                                                                    |

> Note: In practice, begin writing the **simulator's basic version in Phase 8** (a minimal one) so ingestion can be tested; Phase 15 expands it. Likewise, stand up the **email provider, queue and Mailpit during Phase 4** (verification and password-reset emails are real from day one) and the **Valhalla routing service as soon as Phase 6** (so zone-avoidance and ETA work can be prototyped early); the full notification matrix and navigation experience still land in Phases 11A and 14A. Security, tests and docs are **continuous** — each phase must include its own tests and doc updates; Phases 18–21 are consolidation and verification passes, not the first time those concerns are addressed.

---

## 9. Global Definition of Done (Applies to Every Phase)

- [ ] Code merged via PR with passing CI (lint, typecheck, tests).
- [ ] New endpoints validated with Zod, documented in OpenAPI, covered by integration tests including **role matrix and ownership checks**.
- [ ] New UI built **only** from `components/ui` primitives and theme tokens; responsive; loading/empty/error states present; keyboard accessible.
- [ ] No business logic in controllers or components; no SQL outside repositories; no cross-module repository imports.
- [ ] No secrets, no coordinates or tokens in logs.
- [ ] Migrations have working `down` scripts.
- [ ] `docs/CHANGELOG.md` and relevant docs updated; any decision recorded in `DECISIONS.md`.
- [ ] Any new user-visible event that someone should know about is added to the **notification matrix** (Phase 11A) with a template, recipient rule and test — or explicitly recorded as "no notification".
- [ ] Domain events are published **after** the transaction commits; no email or push is ever sent from inside a transaction or a request handler.
- [ ] Any new security-relevant action emits a `security.signal`.

---

## 10. Risk Register

| Risk                                                      | Impact                                                         | Mitigation                                                                                                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map lag with many markers                                 | Poor demo                                                      | Canvas rendering, clustering, imperative updates, throttled broadcast, benchmark early (Phase 12)                                                                                                          |
| GPS noise causing false alerts                            | Alert spam, loss of trust                                      | Accuracy filtering, hysteresis, jump detection                                                                                                                                                             |
| DB write storm from telemetry                             | Slowdowns                                                      | Redis hot path, batched inserts, throttled `last_known_location` updates, partitioning                                                                                                                     |
| Browser cannot track in background                        | Gaps in driver data                                            | Document limitation honestly; Wake Lock; offline queue; PWA guidance                                                                                                                                       |
| Scope creep                                               | Missed deadline                                                | Phase 17 strictly optional; non-goals enforced                                                                                                                                                             |
| Satellite tile provider terms/limits                      | Broken basemap                                                 | Configurable providers, attribution, fallback layer, caching within terms                                                                                                                                  |
| Lng/lat order bugs                                        | Wrong locations                                                | Shared geo helpers, golden tests, named fields in API                                                                                                                                                      |
| Security gaps in location data                            | Reputational/ethical                                           | Role-scoped access, privacy mode, retention policy, security test suite                                                                                                                                    |
| Dev environment inconsistencies                           | Wasted time                                                    | Docker Compose, pinned versions, `.env.example`, CI parity                                                                                                                                                 |
| Real emails landing in spam / failing silently            | Customers and ops miss critical updates                        | Sending domain with SPF/DKIM/DMARC, reputable SMTP host, suppression on permanent SMTP rejections, email log with retry, admin-visible failures; hosted provider with webhooks is a documented future swap |
| SMTP host sending limits or throttling                    | Emails delayed or dropped during bursts                        | Queue with bounded concurrency and per-recipient caps, check the host's limits before the demo, digest for medium-severity security mail                                                                   |
| Duplicate or missing emails                               | Confused users, lost trust                                     | Dedupe key per event+recipient, publish-after-commit, queue with retries, matrix-driven tests, replay tests                                                                                                |
| Mail-bombing or abuse of email-triggering endpoints       | Reputation damage, provider suspension                         | Per-recipient caps, rate limits on register/resend/forgot/request endpoints, global circuit breaker                                                                                                        |
| Alert fatigue from suspicious-activity emails             | Admin ignores real attacks                                     | Severity thresholds, deduplication/aggregation, digests for medium severity, tunable rules                                                                                                                 |
| Routing data size, build time and RAM                     | Slow setup, heavy local machine                                | Use a regional OSM extract only, document requirements, ship pre-built tiles as a Compose volume if needed, `FakeProvider` for tests                                                                       |
| Navigation false off-route / missed turns from GNSS noise | Driver frustration, wrong reroutes                             | Accuracy gating, forward-biased snapping, hysteresis, dead reckoning, simulator-driven tests plus a real field test                                                                                        |
| Browser limits (background throttling, speech unlocking)  | Navigation degrades when the screen is off or audio is blocked | Wake Lock, user-gesture audio unlock, visual fallback, honest documentation of PWA limits                                                                                                                  |
| No live traffic in open-source routing                    | ETAs less accurate in congestion                               | State the limitation openly; ETA scaling from observed speed; live-traffic routing listed as an optional extension                                                                                         |
| OSM data gaps (closed or missing roads)                   | Bad routes                                                     | Reroute cap with dispatcher alert, ability to update the extract, report-a-problem note in docs                                                                                                            |

---

## 11. Assumptions (edit if wrong)

1. "Satellite data" means **GNSS/GPS telemetry** from devices plus **satellite imagery basemaps** in Leaflet; no raw satellite signal (RINEX/NMEA hardware) processing is required. If NMEA/GPX parsing is desired, it is covered by the GPX importer in Phase 15 and can be extended.
2. The project is a portfolio/interview showcase, so the demo experience and documentation quality weigh as heavily as feature breadth.
3. Redis is acceptable as an added dependency (hot cache, rate limiting, streams, Socket.IO adapter).
4. Driver app is a responsive PWA, not a native app.
5. Target scale for the demo is hundreds (not millions) of concurrent assets; the architecture is documented to scale horizontally.
6. Single-tenant system.
7. **Email (real):** emails are sent with **Nodemailer over SMTP** (decided). You will supply SMTP credentials and ideally a sending domain with SPF/DKIM/DMARC. During development emails go to Mailpit so nothing real is sent accidentally. A hosted email API is a later, optional swap behind the `EmailProvider` interface. Email is the only outbound channel; SMS and push are out of scope (Phase 17 optional).
8. **"Inbound" email** is interpreted as _the parcel is on its way to the customer_ (status `IN_TRANSIT`), with an optional "arriving soon" email driven by navigation ETA. **"Arrives at destination"** is `ARRIVED`; a separate delivery-confirmation email on `DELIVERED` is optional (config flag).
9. **"Driver and dispatcher are told of a new request"** is interpreted as: all active dispatchers are emailed; drivers are emailed as an _invitation_ only if they are available and near the pickup (configurable radius and maximum count, can be turned off), because a request has no assigned driver yet. The **assigned** driver always gets an assignment email and a cancellation email if the customer cancels. **Please confirm or adjust this rule.**
10. **"Suspicious activity"** is defined by the rule table in Phase 11A (brute force, token reuse, impossible travel, privilege-escalation and IDOR probing, telemetry spoofing, mass requests, credential-change bursts, unusual privileged logins). The list and thresholds are tunable; tell me if you have specific scenarios in mind.
11. **Turn-by-turn navigation** uses a self-hosted open-source routing engine (Valhalla recommended) on an OpenStreetMap extract of one demo region, running in the driver's browser/PWA with browser GNSS. It is a driver aid for the portfolio, not certified navigation software, and has **no live traffic**. Browsers cannot reliably track location or speak instructions with the screen off; the plan documents this rather than hiding it.

---

## 12. First Week Kickoff Checklist (Immediate Next Actions)

1. Phase 0 complete (repo, tooling, Compose, CI).
2. Phase 1 complete (theme, layouts, primitives, styleguide) — **stop and review the design with fresh eyes before moving on**.
3. Phase 2 complete (schema, PostGIS indexes, seed, `EXPLAIN` proof).
4. Begin Phase 3–4 (core + auth) with the role matrix test suite written **first**.
