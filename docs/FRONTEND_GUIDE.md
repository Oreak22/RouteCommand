# Frontend guide

## Structure

- `src/app/` contains providers, routing, error handling, and auth/role guard stubs.
- `src/components/ui/` contains one reusable, accessible primitive per file.
- `src/components/common/` contains composites used across routes, such as `PageHeader` and `DataTable`.
- `src/features/<name>/` contains feature-specific UI and behavior. Keep its public surface in `index.ts` when it grows beyond a single component.
- `src/features/zones/` owns zone contracts, query hooks, geometry checks, and the dispatcher map zone editor.
- `src/layouts/` contains the five route shells. Pages render through an `<Outlet />` and do not duplicate global navigation.
- `src/pages/` contains thin route compositions. The development-only styleguide lives at `/__styleguide`.
- `src/theme/` contains the DaisyUI theme names, theme provider, and domain color helpers.
- `src/features/drivers/` owns fleet API hooks and the dispatcher driver/vehicle screens plus the driver's availability workspace and job overview.
- `src/features/shipments/` owns shipment request forms, map-picked pickup/dropoff coordinates, role-scoped shipment lists, lifecycle actions, cancellation, and the event timeline.
- `src/features/realtime/` owns the authenticated Socket.IO singleton/provider, typed event hook, connection status, room subscriptions, and Zustand live-position store.
- `src/features/telemetry/` owns driver GNSS capture, battery-aware sampling, IndexedDB offline telemetry and shipment-action queues, reconnect synchronization, and the driver PWA's offline cache support.
- `src/pages/DriverMapPage.tsx` composes the driver's last reported location with read-only active zone overlays; the API keeps zone editing restricted to administrators and dispatchers.
- `src/features/tracking/` owns the public tracking API client and map; its anonymous `/tracking` Socket.IO client is isolated from the authenticated realtime provider and falls back to periodic HTTP refresh.

Use PascalCase for React component files and named exports. Keep page data and business rules outside generic UI components. Use TanStack Query for server state; use focused Zustand stores only when a UI state needs to be shared across distant components.

Realtime events are transient deltas. Keep server state in TanStack Query; use `useLivePosition(driverId)` for the latest map position and subscribe to the socket through `useSocketEvent` or `useRealtime`. The provider rejoins authorized shipment/tracking rooms after reconnect and requests a fresh operations snapshot for dispatcher/admin sessions. Compare per-driver sequence values before applying position updates.

## Components and styles

1. Compose a page from one of the five layouts and common components.
2. Use `components/ui` primitives for repeated controls. Add a primitive there before repeating DaisyUI markup.
3. Use only semantic DaisyUI colors (`primary`, `base-100`, `success`, and similar), the domain utilities defined in `theme/domain-colors.ts`, and the Tailwind spacing/type scales.
4. Avoid raw color values, one-off spacing values, and direct access to theme CSS variables in feature components. Add a token to `src/index.css` and document it in `src/theme/tokens.md` first.
5. Include visible focus, keyboard behavior, labels, and loading/empty/error states. Respect reduced-motion preferences.
6. Keep coordinates, IDs, and timestamps in the `font-data` utility.

## Theme behavior

The two themes are `routecommand-dark` and `routecommand-light`. `ThemeProvider` resolves the saved preference or system preference, updates the root `data-theme`, and persists explicit choices in localStorage. `index.html` applies the preference before React renders to prevent a flash of the wrong theme.

## Adding a route or feature

1. Add the route to `app/AppRouter.tsx` using a lazy page import.
2. Select the matching layout. Keep role guards around authenticated operational routes and enforce permissions in the API as well.
3. Put feature behavior under `features/<name>/`; keep route files focused on composition.
4. Define request/response contracts in `packages/shared` when the feature crosses the API boundary.
5. Add a unit test for non-trivial interactions and verify keyboard and narrow-screen behavior. Fleet data uses TanStack Query; keep optimistic availability changes reversible and invalidate related driver/vehicle lists after assignment updates. Zone map data uses TanStack Query; edits use the server timestamp for optimistic concurrency and refresh both the list and map collection after mutations.
6. Add any new theme token to `src/theme/tokens.md` and the `/__styleguide` page.

## Map conventions

`features/map/MapCanvas.tsx` owns the Leaflet container, layer switcher, scale control, attribution, and marker icon fix. It renders no product data in Phase 1. Keep the basemap provider configurable with `VITE_SATELLITE_TILE_URL` and preserve provider attribution.

Zone polygons live in the `features/map/ZonesLayer` component. Convert GeoJSON `[lng, lat]` positions to Leaflet `[lat, lng]` only through the shared zone geometry helper. Zone colors come from the stored zone color, and zone type labels use the domain color tokens. Drawing controls are owned by the zones feature and save circles as polygon approximations.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` from the workspace root. Use `/__styleguide` in development to inspect both themes and each primitive state.
