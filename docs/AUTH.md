# Authentication and authorization

The API exposes auth routes under `/api/v1/auth` and administrator user management under `/api/v1/users`.

- Passwords use Argon2id. Login failures share a generic response and are counted by HMAC-derived email/IP keys in Redis.
- Access JWTs use HS256 only, with issuer/audience checks and `sub`, `role`, and `sid` claims. Protected requests reload the active user and check the refresh-token family is still active.
- Refresh tokens are opaque random values. PostgreSQL stores SHA-256 hashes; successful refresh rotates the token in the same family, while replay revokes that family.
- The refresh cookie is `httpOnly`, `Secure`, `SameSite=Strict`, and scoped to `/api/v1/auth`. Refresh/logout also require the `X-Requested-With: RouteCommand` header.
- The browser stores access tokens in module memory only, refreshes before expiry, retries one authenticated request after a 401, serializes cross-tab refresh with Web Locks, and broadcasts logout.
- Email verification and password reset actions use single-use hashed tokens with expiry and generic recovery responses. Tokens live in URL fragments and are not sent with the initial browser request.
- Admin user changes are audited. Creating a driver and its driver profile occurs in the same DB transaction. Deactivation revokes sessions and sets a driver offline.

Endpoints: `POST /register`, `/login`, `/refresh`, `/logout`, `/logout-all`, `/change-password`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`; `GET /me`; and administrator-only user list/create/read/update/soft-delete/force-reset routes. OpenAPI documents bearer auth and auth routes at `/docs` outside production.

## Manual cross-tab check

1. Start the local stack with `docker compose up -d` and open `http://localhost:5173` in two tabs.
2. In tab A, sign in as the seeded admin (`admin@routecommand.local`, local demo password `RouteCommandDemo!2026`). If the seed is not loaded, use another active admin account.
3. Open the same origin in tab B. It should restore the session through `POST /api/v1/auth/refresh`. In DevTools → Network, confirm a `200` refresh response. Reload both tabs close together; both should remain signed in while refreshes are serialized.
4. Before logging out, open DevTools → Application → Storage. Confirm no access JWT appears in Local Storage or Session Storage. Under Cookies, `routecommand_refresh` should be `HttpOnly`, `Secure`, `SameSite=Strict`, and scoped to `/api/v1/auth`. From the Console, `document.cookie` should not expose that cookie.
5. Click **Sign out** in tab A. Tab B should immediately clear its signed-in state and return to login. Confirm the logout request returns `204` and its cookie is cleared.

Use `localhost` for this local check so the browser accepts the Secure cookie on its loopback origin. The demo password is only for the local seed; never use it outside development.

The user-run Phase 4 Testcontainers integration suite passes and exercises role boundaries, token rotation/replay, logout revocation, Mailpit delivery, private reset responses, and atomic driver profile creation. See [GEOIP.md](GEOIP.md) to configure an offline GeoLite2 database. Without one, the API records the login IP and hashed user-agent/coarse-IP fingerprint, while location remains empty.
