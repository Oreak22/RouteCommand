# AGENT.md — Operating Manual for AI Agents (and Humans) Working on RouteCommand

> **Read this file completely before touching anything.** It tells you how to start, how to continue, what you must never do, and how to hand the work to the next agent. `plan.md` says **what** to build and in **what order**. This file says **how to behave while building it**.

---

## 1. Precedence of Instructions

When instructions conflict, follow this order (highest first):

1. The user's most recent explicit instruction in the current conversation.
2. This file (`agent.md`).
3. `plan.md` (the master plan: scope, phases, order, definitions of done).
4. `docs/DECISIONS.md` (recorded decisions, newest wins).
5. Your own preferences. These come last and never override the above.

If the user's instruction contradicts `plan.md` or this file, **do what the user says, then record the change** in `docs/DECISIONS.md` and update `plan.md` so the documents do not drift. If the conflict could break something or is unclear, ask first (see section 14).

---

## 2. The Project in One Paragraph

**RouteCommand** is a delivery/logistics platform built to demonstrate the ability to **read, validate, store, secure and visualise satellite-derived GNSS/GPS location data in real time**. It is a logistics product on the surface and a command-and-control (C2) style operational-picture system underneath (live asset tracking, geofencing, role-based access, offline resilience). Roles: `ADMIN`, `DISPATCHER`, `DRIVER`, `CUSTOMER`, plus a limited public tracking page. Headline features: live dispatcher map (Leaflet, satellite imagery layer), telemetry ingestion pipeline, geofence alerts, dispatch/assignment, real email notifications (Nodemailer), suspicious-activity alerts to admins, driver PWA with offline queue, and real-time turn-by-turn navigation built on an open-source routing engine.

It is a portfolio/interview showcase. **Quality, clarity, tests and documentation matter as much as features.**

---

## 3. Files You Must Know

| File                                                                                                                                                | Purpose                                                                                       | When to read                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `plan.md`                                                                                                                                           | Master plan: vision, stack, architecture, domain model, every phase with steps/edge cases/DoD | Before starting any phase; re-read the current phase fully before coding |
| `agent.md`                                                                                                                                          | This file                                                                                     | Start of every session                                                   |
| `docs/PROGRESS.md`                                                                                                                                  | Live checklist of phases and what is done/in-progress/blocked                                 | **First thing every session, last thing before you stop**                |
| `docs/DECISIONS.md`                                                                                                                                 | ADR log of decisions made                                                                     | Before changing anything architectural                                   |
| `docs/CHANGELOG.md`                                                                                                                                 | What changed and when                                                                         | Update at the end of each phase                                          |
| `docs/FRONTEND_GUIDE.md`                                                                                                                            | Component/theme conventions (created in Phase 1)                                              | Before any frontend work                                                 |
| `docs/TELEMETRY.md`, `docs/SPATIAL_QUERIES.md`, `docs/EMAIL.md`, `docs/ROUTING.md`, `docs/NAVIGATION.md`, `docs/SECURITY.md`, `docs/PERFORMANCE.md` | Domain docs, created in their phases                                                          | Before touching that area                                                |

If `docs/PROGRESS.md` does not exist yet, the project has not been started: go to section 5 (Starting from zero).

---

## 4. Locked Technology Stack (do not change without a recorded decision)

**Frontend:** React 18+ (Vite) · TypeScript strict · Tailwind CSS · **DaisyUI** · **Leaflet** via `react-leaflet` (+ `leaflet.markercluster`, `leaflet-draw`, optional `leaflet.heat`) · TanStack Query · Zustand · React Router · React Hook Form + Zod · `socket.io-client` · `lucide-react` · Vitest + React Testing Library + Playwright.

**Backend:** Node.js LTS · TypeScript strict · **Express** · **PostgreSQL + PostGIS** (`pg` + `node-pg-migrate`, raw SQL in repositories) · **Redis** · **Socket.IO** · **BullMQ** (queues) · Zod · JWT (short-lived access) + rotating httpOnly refresh cookie · `argon2` · Pino · Helmet / CORS allow-list / `express-rate-limit` (Redis store) / HPP · OpenAPI via Zod · Vitest or Jest + Supertest + Testcontainers.

**Email:** **Nodemailer over SMTP**, wrapped behind an `EmailProvider` interface. Mailpit in development. (Hosted email APIs are a possible future swap, not part of the current scope.)

**Routing/navigation:** Self-hosted open-source routing engine (**Valhalla** recommended) behind a `RoutingProvider` interface, on an OpenStreetMap extract.

**Tooling:** npm/pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`) · Docker Compose · ESLint + Prettier + Husky + lint-staged + commitlint · GitHub Actions.

> Adding a new library is allowed only if it does not duplicate something above, is actively maintained, and you record why in `docs/DECISIONS.md`. Replacing anything above requires the user's approval.

---

## 5. Starting From Zero (first session only)

If the repository is empty or `docs/PROGRESS.md` is missing:

1. Read `plan.md` fully (sections 0–6, then Phase 0 and Phase 1 in detail).
2. Execute **Phase 0** exactly as written (monorepo, TypeScript, lint/format/hooks, Docker Compose with Postgres+PostGIS, Redis and Mailpit, env validation, CI skeleton, docs scaffolding).
3. Create `docs/PROGRESS.md` from the template in section 12, with every phase from `plan.md` listed and Phase 0 marked as done only after its DoD is met.
4. Commit `plan.md` and `agent.md` to the repository root if they are not already there.
5. Move to **Phase 1 (theme, layouts, UI primitives)** before any feature. This ordering is deliberate: layout and theme are defined first for consistency.

---

## 6. Continuing the Project (every session)

Follow this protocol **every time**, in order:

1. **Orient.** Read `docs/PROGRESS.md`, then `docs/DECISIONS.md` (newest entries), then the section of `plan.md` for the phase you are on.
2. **Verify the ground.** Run the install, typecheck, lint and test commands. If something is already red, **stop and fix or report it before adding new work**. Never build on a broken base.
3. **Check prerequisites.** Every phase has a "Why this position" in the order table (plan.md section 8). Do not start a phase whose prerequisites' DoD are not met.
4. **Plan the slice.** Break the phase into small, independently testable steps. Use the task list. Prefer many small, reviewable commits over one huge one.
5. **Build the step** following sections 8–10 of this file. Write the tests **with** the code, not after.
6. **Verify.** Run lint, typecheck, unit and integration tests. For UI work, actually run the app and exercise the feature (including loading, empty and error states); a passing typecheck is not proof the screen works.
7. **Document.** Update the relevant doc, `docs/CHANGELOG.md`, and any decision in `docs/DECISIONS.md`.
8. **Update `docs/PROGRESS.md`** (status, what is next, any blockers, anything the next agent must know).
9. Only then stop or move to the next step. Never end a session with failing tests, uncommitted half-work, or an out-of-date `PROGRESS.md`.

**Phases are done only when their Definition of Done in `plan.md` is fully satisfied** — not when the code "looks finished".

---

## 7. Phase Order (summary — the details are in `plan.md`)

`0` Setup → `1` **Frontend theme/layout/primitives** → `2` Database (PostGIS) → `3` Backend core → `4` Auth & RBAC (+ start email infrastructure) → `5` Vehicles & drivers → `6` Zones (+ stand up routing service) → `7` Shipments & state machine → `8` Telemetry ingestion → `9` Real-time gateway → `10` Geofencing & alerts → `11` Dispatch → `11A` Notifications, real email & suspicious-activity alerts → `12` Dispatcher live map → `13` Customer/public tracking → `14` Driver PWA & offline → `14A` Turn-by-turn navigation → `15` Simulator & demo data → `16` History/replay/analytics → `17` Optional extras → `18` Security hardening → `19` Performance & observability → `20` Testing/CI consolidation → `21` Documentation & interview readiness.

Rules about order:

- **Do not reorder or skip phases.** If you think the order is wrong, raise it (section 14); do not just do it.
- A minimal simulator is allowed during Phase 8; email infrastructure starts during Phase 4; the routing service is stood up around Phase 6. These early starts are explicitly allowed in `plan.md`.
- Phase 17 is optional and comes only after everything else is finished.
- Security, tests and docs are **continuous**: each phase includes its own. Phases 18–21 are verification passes, not the first time these are considered.

---

## 8. Architecture Rules (non-negotiable)

### 8.1 Everything is modular

- **Backend:** feature modules under `apps/api/src/modules/<name>/`, each with `routes → controller → service → repository`, plus `schemas`, `types`, `tests`, and a public `index.ts`.
  - **Routes** only wire paths and middleware.
  - **Controllers** parse/validate input, call a service, shape the response. **No business logic.**
  - **Services** hold business rules and transactions. **No SQL, no `req`/`res`.**
  - **Repositories** hold **all SQL**. No business rules.
  - Modules talk to each other through **service interfaces or domain events**. **Never import another module's repository.** Never reach into another module's internals; use its `index.ts`.
  - Shared infrastructure lives in `core/`, `infra/`, `middleware/`, `config/`.
- **Shared contracts** (Zod schemas, types, enums, permission matrix, socket event names/payloads, navigation types) live in `packages/shared`. Do not duplicate a type in both apps.

### 8.2 The frontend is heavily componentised

- Hierarchy: `components/ui` (primitives wrapping DaisyUI) → `components/common` (composites) → `features/<name>` (organisms with data/logic) → `pages` (thin composition) → `layouts`.
- **Pages only compose.** No raw layout markup or one-off styling in a page.
- **Features own their data** (`api/` hooks, `components/`, `store/`, `types`, `index.ts`).
- **Never write repeated raw DaisyUI/Tailwind class soup in feature code.** Use or extend a `ui` primitive.
- One component per file, named exports, typed props, loading/empty/error states, accessibility attributes, a test for non-trivial behaviour.
- The map is a first-class module (`features/map`): `MapCanvas` plus layer components (`DriversLayer`, `ZonesLayer`, `ShipmentsLayer`, `TrailLayer`, `HeatLayer`, `BaseLayerSwitcher`).

### 8.3 Layout and theme are fixed first and never bypassed

- All screens use one of the five layouts: `AuthLayout`, `AppShell`, `MapLayout`, `DriverLayout`, `PublicLayout`.
- Use only **semantic theme tokens** (`primary`, `base-100`, `success`, …) and the **domain colour tokens** (driver status, shipment status, alert severity, zone type). **No raw hex colours, no ad-hoc spacing, no new fonts** inside components.
- If a design need cannot be met, extend the theme or a primitive and document it in `theme/tokens.md` and `docs/FRONTEND_GUIDE.md`. Do not special-case it in a feature.

### 8.4 Data and geospatial rules

- Coordinates are **`(lng, lat)` order** in PostGIS and GeoJSON. In APIs and UI use **named fields** `lat` and `lng`. Use the shared geo helpers; never hand-order coordinate arrays inline.
- SRID **4326**. Use `geography` for distance/radius; be careful with `geometry` vs `geography` (use `ST_Covers`, `ST_DWithin`, casts deliberately).
- **GiST index on every spatial column.** Verify with `EXPLAIN ANALYZE` when you add or change a spatial query.
- Timestamps are UTC `timestamptz`, ISO-8601 on the wire. IDs are UUIDs. DB names are `snake_case`; TS/JSON are `camelCase`.
- **Every migration has a working `down`.** Never edit an already-applied migration; add a new one.
- Soft-delete (`is_active`) instead of hard-deleting entities referenced by history.

### 8.5 Real-time and telemetry rules

- The telemetry **hot path must not hit PostgreSQL synchronously**: validate → Redis (latest position, geo index) → publish; history is written by a **batched** cold path.
- GNSS **accuracy is a first-class signal**: low-accuracy fixes are stored but flagged and are **not** used for live position or geofence decisions.
- Telemetry writes are idempotent (`(driver_id, recorded_at)` unique, `ON CONFLICT DO NOTHING`).
- A driver's `driver_id` for telemetry comes **from the token, never from the payload**.
- Socket authorisation is by **server-validated room membership**; never trust a client-specified room.
- Live positions on the client live in a **Zustand store keyed by driver id** and markers update **imperatively**. Do not re-render the whole map tree per message and do not replace a whole array on each update.

### 8.6 Security rules

- **Authorisation is enforced on the server**, including **object-level checks** (a driver may touch only their own shipments/telemetry; a customer only their own shipments). Hiding a button is not security.
- Access token only in memory on the client; refresh token only in an httpOnly, Secure, SameSite=Strict cookie; refresh tokens are rotated with reuse detection.
- Validate **all** input with Zod. All SQL is **parameterised**. No `dangerouslySetInnerHTML`.
- **Never log** secrets, tokens, passwords or raw coordinates. Redact.
- No secrets in the repository. Every new env var goes in `.env.example` **and** the Zod env schema.
- Public tracking never exposes PII or route geometry; it returns limited, optionally rounded/delayed location only.
- Security-relevant actions emit `security.signal` events (see plan.md Phase 4/11A).

### 8.7 Email and notification rules (Phase 4 infrastructure, Phase 11A matrix)

- Email is sent with **Nodemailer over SMTP** through the `EmailProvider` interface. Business code calls the notifications service, **never Nodemailer directly**.
- Emails are **queued (BullMQ)**, one job per recipient, **never sent inside a request handler or a DB transaction**.
- Domain events that cause emails are **published only after the DB transaction commits**.
- Every email has a **dedupe key** (`type:entityId:version:recipientId`) so replays never double-send.
- The **notification matrix in `plan.md` (Phase 11A) is the contract.** Adding a user-visible event means adding a matrix row, a template (HTML + plain text), a recipient rule and a test.
- Only active users with verified emails are emailed. Security and account emails cannot be disabled by the user.
- Emails contain a tracking **link**, not live coordinates, and never tokens/passwords in security alerts.
- In development and tests, mail goes to **Mailpit**, never to real addresses.

### 8.8 Navigation rules (Phase 14A)

- Route computation is delegated to the routing engine through `RoutingProvider`. The rest of the system uses **our normalised `Route`/`Step` types**, never provider JSON.
- `NavigationEngine` (in `packages/shared/navigation`) is **pure TypeScript**: no DOM, no React, no network. It must stay deterministic and unit-testable.
- Each announcement tier fires **exactly once** per step; off-route detection uses hysteresis; progress is monotonic; reroutes are single-flight and rate-limited.
- Restricted zones are passed to the engine as avoid polygons.
- Never claim live-traffic routing. Never auto-transition a shipment on arrival; only **suggest** `ARRIVED`.

---

## 9. Conventions

- **API:** REST under `/api/v1`. Success `{ "data": ..., "meta": {...} }`. Failure `{ "error": { "code", "message", "details", "requestId" } }`. Status codes: 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict/illegal transition, 422 validation.
- **Errors:** throw typed `AppError` subclasses; the central handler formats them. Never leak stack traces in production.
- **Shipment lifecycle:** only through the state machine (`shipments/stateMachine.ts`). Never update a shipment's status with a raw `UPDATE` elsewhere. Every transition writes a `ShipmentEvent` in the same transaction.
- **Pagination:** cursor-based for large lists (telemetry, audit), offset acceptable for small admin tables.
- **Git:** short-lived branches, **Conventional Commits** (`feat(shipments): …`), PRs must pass CI. One logical change per commit.
- **Naming:** files `kebab-case` or `PascalCase` for React components, consistently with what already exists. Match the surrounding code before inventing a style.
- **Comments:** explain _why_, not _what_. Document non-obvious geospatial maths and thresholds.
- **Config over magic numbers:** thresholds (accuracy limits, rate limits, geofence hysteresis, off-route distances, email caps) are named config values with documented defaults.

---

## 10. Things You Must NEVER Do

1. **Never skip or reorder phases**, or start a phase before the previous DoD is met.
2. **Never put business logic in controllers or components, SQL outside repositories, or import another module's repository.**
3. **Never bypass the layouts, theme tokens or UI primitives** with one-off styling or raw colours.
4. **Never trust client input** for identity, role, ownership, room membership or `driver_id`.
5. **Never write synchronously to PostgreSQL on the telemetry hot path.**
6. **Never send email from inside a request handler or a transaction, or call Nodemailer directly from business code.**
7. **Never edit an applied migration, hard-delete referenced rows, or run destructive commands (drop tables, `rm -rf`, `git reset --hard`, force-push) without the user's explicit approval.**
8. **Never commit secrets, `.env` files, real credentials, or real user data.** Never send mail to real addresses from dev or tests.
9. **Never disable, delete or weaken a failing test, lint rule, type check or security check to make something pass.** Fix the cause. If a test is genuinely wrong, correct it and explain why in the commit.
10. **Never "fix" one thing by silently changing the contract** in `packages/shared` (schemas, enums, socket events, permission matrix). Contract changes need all consumers and tests updated together, plus a changelog line.
11. **Never swap the stack** (e.g. replace Leaflet, DaisyUI, Express, Nodemailer, PostGIS) or add a competing library without approval.
12. **Never invent features, endpoints or behaviour not in `plan.md`** without recording it as a decision and getting approval when it changes scope.
13. **Never claim something works without running it.** No "should work". State what you ran and what you observed.
14. **Never leave TODOs or stubs unmarked.** If something is intentionally deferred, record it in `docs/PROGRESS.md` under "Deferred / Known gaps" with the phase that will deliver it.
15. **Never refactor unrelated code during a feature change.** Keep diffs focused; propose refactors separately.
16. **Never expose the routing engine, Redis, Postgres or Mailpit publicly**, and never proxy raw routing-engine responses to the browser.

---

## 11. Common Pitfalls (check yourself against these)

- Swapping `lat`/`lng` order. Always use the shared helper and a golden test.
- Using `ST_Contains` on `geography` without a cast; prefer `ST_Covers`/`ST_DWithin`.
- Forgetting a GiST index, then shipping a sequential scan.
- Trusting device timestamps: store both `recorded_at` and `received_at`; use `received_at` for staleness.
- Replacing the whole live-positions array on every socket message (causes full re-renders).
- Duplicate socket listeners after hot reload; not resubscribing rooms after reconnect; not requesting a fresh snapshot after reconnect.
- Sending email before the transaction commits (email for a change that rolled back), or sending a stale "on the way" email after the shipment was cancelled (check state at send time).
- Alert flapping at zone boundaries (needs debounce/hysteresis) and duplicate alerts from missing `GeofenceState`.
- Declaring "off route" from a single noisy fix or while accuracy is poor.
- Announcing the same turn instruction repeatedly, or not cancelling queued speech on reroute.
- Storing the access token in `localStorage`.
- Returning different responses for "user exists" vs "does not exist" on login/forgot-password (enumeration).
- Writing tests that pass because they mock the thing being tested.
- Leaving `console.log` of coordinates or tokens.

---

## 12. `docs/PROGRESS.md` — Template and Handoff Protocol

Create this file in Phase 0 and keep it current. Format:

```md
# Progress

Last updated: <date> by <agent/person>
Current phase: <number and name>
Next action: <one specific sentence>

## Phase checklist

- [x] Phase 0 — Setup & tooling (DoD met <date>)
- [ ] Phase 1 — Frontend theme, layouts, UI primitives ← IN PROGRESS (steps 1–4 of 10 done)
- [ ] Phase 2 — Database
      ...(every phase from plan.md, including 11A and 14A)

## In-progress notes (what the next agent must know)

- <e.g. "ThemeProvider done; Button/Input/Modal primitives done; Table not started">

## Deferred / known gaps

- <item> — to be delivered in Phase <n>

## Blockers / questions for the user

- <item>

## How to run right now

- <commands that currently work, ports, demo credentials>
```

**Handoff rule:** before you stop, a fresh agent reading only `agent.md`, `plan.md` and `docs/PROGRESS.md` must be able to continue without asking you anything. If they could not, your handoff is incomplete.

---

## 13. Commands (created in Phase 0; keep them working)

```bash
npm install                 # install all workspaces
docker compose up -d        # Postgres+PostGIS, Redis, Mailpit (+ worker, valhalla when added)
npm run dev                 # api + web in watch mode
npm run lint                # ESLint + Prettier check
npm run typecheck           # TypeScript across all workspaces
npm run test                # unit + integration tests
npm run db:migrate          # apply migrations (also: db:rollback)
npm run db:seed             # deterministic, idempotent seed data
npm run sim                 # telemetry simulator (e.g. -- --drivers 200 --speed 1x)
npm run build               # production builds
```

Local URLs once running (confirm real ports in `README.md`): web app, API (`/health/live`, `/health/ready`, `/docs` in dev), Mailpit inbox for viewing sent emails.

If a script named here does not exist yet, it is created by the phase that needs it; do not invent a different name.

---

## 14. When You Are Unsure — Ask, Don't Guess

**Stop and ask the user** (use the question tool if available; otherwise state the question plainly) when:

- the request conflicts with `plan.md`, this file, or a recorded decision;
- a change would alter a shared contract, the data model, the notification matrix, the permission matrix or a public API;
- a step requires a destructive or irreversible action;
- a requirement in `plan.md` is ambiguous and the two readings lead to meaningfully different work (the cost of guessing wrong is high);
- you need credentials, a domain, SMTP details, a map extract or any external resource you do not have.

**Do not stop** for things you can resolve from `plan.md`, existing code, or a sensible, reversible default. In that case choose the default, say so in your summary, and record it in `docs/DECISIONS.md`.

Decision record format (`docs/DECISIONS.md`):

```md
## ADR-<n>: <title> — <date>

Context: <why this came up>
Decision: <what was chosen>
Alternatives considered: <short list>
Consequences: <trade-offs, follow-ups>
```

---

## 15. Quick Checklists

### Adding an API endpoint

1. Define request/response **Zod schemas** in `packages/shared` (or the module `schemas`).
2. Add route → controller → service → repository (SQL only in the repository).
3. Add `authenticate` + `authorize(...roles)` **and** object-level ownership checks.
4. Add rate limiting if it is public, expensive or can trigger email.
5. Register in OpenAPI.
6. Tests: happy path, validation errors, **every role** (allowed vs 401/403), ownership, edge cases.
7. Update the permission matrix and `docs/CHANGELOG.md`.

### Adding a database change

1. New migration (up **and** down). Add GiST/B-tree indexes as needed. Add `CHECK` constraints.
2. Update repository code and types; update the seed if needed.
3. If spatial: `EXPLAIN ANALYZE` evidence in `docs/SPATIAL_QUERIES.md`.
4. Test migrate up → down → up on a clean DB.

### Adding a frontend feature

1. Confirm the layout it belongs to. Compose from existing `ui`/`common` components; add a primitive if one is missing (with test and styleguide entry).
2. Create `features/<name>` with `api/`, `components/`, `store/` (if needed), `types`, `index.ts`.
3. Page is a thin composition. Handle loading, empty and error states. Check keyboard access and contrast.
4. Run the app and use the feature at desktop and (for driver/public) 360 px widths.

### Adding a socket event

1. Add name and typed payload to `packages/shared/socketEvents.ts`.
2. Server: authorise by room membership; throttle/aggregate if high-frequency; include a sequence number if ordering matters.
3. Client: typed `useSocketEvent` subscription with cleanup; resubscribe on reconnect; request a snapshot if state could have been missed.
4. Test room isolation (unauthorised client must not receive it).

### Adding an email type

1. Add a row to the **notification matrix** in `plan.md` Phase 11A (recipients, trigger, content).
2. Add the typed template (HTML + plain text) using the shared layout and theme tokens.
3. Add the recipient-resolution function (pure, unit-tested) and the dedupe-key rule.
4. Publish the triggering domain event **after commit**.
5. Tests: exact recipients, dedupe on replay, stale-state check at send time, template snapshot, Mailpit end-to-end.

### Adding a suspicious-activity rule

1. Small pure rule class with documented rationale and configurable thresholds.
2. Emits a `SecurityEvent` with severity and evidence; aggregation/dedupe window defined.
3. Scenario test: feed signals → exactly one event and one admin email (for High/Critical).

### Finishing a phase

1. Every step in the phase done; every edge case handled or explicitly deferred in `PROGRESS.md`.
2. Lint, typecheck, unit and integration tests green; E2E where the phase defines it.
3. DoD in `plan.md` met, with evidence (commands run, screenshots or measurements where requested).
4. Docs and changelog updated; `PROGRESS.md` updated; decisions recorded.

---

## 16. Global Definition of Done (every change)

- [ ] Lint, typecheck and tests pass locally and in CI.
- [ ] New endpoints validated with Zod, documented in OpenAPI, tested against the **role matrix and ownership checks**.
- [ ] New UI uses only `components/ui` primitives, theme tokens and the defined layouts; responsive; loading/empty/error states; keyboard accessible.
- [ ] No business logic in controllers/components; no SQL outside repositories; no cross-module repository imports.
- [ ] No secrets, tokens or raw coordinates in logs.
- [ ] Migrations have working `down` scripts.
- [ ] Domain events are published after commit; any new user-visible event is in the notification matrix (or explicitly recorded as "no notification"); security-relevant actions emit `security.signal`.
- [ ] `docs/CHANGELOG.md`, relevant docs, `docs/DECISIONS.md` and `docs/PROGRESS.md` updated.

---

## 17. How to Report Your Work

When you finish a session or a phase, tell the user, briefly and honestly:

- what is now done and how you verified it (what you ran and saw);
- anything you chose by default and recorded as a decision;
- anything deferred, broken, or risky;
- the single next action.

Do not describe effort; describe outcomes. Do not claim completion if the Definition of Done is not met.
