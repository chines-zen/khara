# Architecture

## System Overview

There is **one server**: `index.js` (Express). It serves the built React UI as static files and exposes every `/api/*` route the UI calls. It talks to two databases — Snowflake (opportunity data, read-only) and Postgres (sessions, user preferences, hidden-opportunities, SC-opportunity cache, AI-summary cache).

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Browser                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React App (src/, built by vite.config.spa.ts → dist/)   │   │
│  │  ├─ /opportunities → SC-scoped opportunity list + detail │   │
│  │  ├─ /settings      → Preferences, opp-scope, dev tools   │   │
│  │  ├─ /             → Pipeline dashboard                   │   │
│  │  ├─ /admin        → Health monitoring                    │   │
│  │  └─ TanStack Query → Client-side cache & state           │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ fetch('/api/...') — cookie-based session
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│              Express Server (index.js) — the one server          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  middleware/                                              │   │
│  │  ├─ session.js  → express-session + connect-pg-simple    │   │
│  │  └─ auth.js     → Pomerium headers, or DEV_MODE bypass    │   │
│  └────────────────────┬─────────────────────────────────────┘   │
│                       │                                          │
│  ┌────────────────────▼─────────────────────────────────────┐   │
│  │  routes/preferences.js + services/                       │   │
│  │  ├─ sc-lookup.js       → email → Snowflake SC USER_ID    │   │
│  │  ├─ opp-scope.js       → effective ARR/close-date scope  │   │
│  │  ├─ sc-opportunities-cache.js → 12hr Postgres cache      │   │
│  │  ├─ hidden-opportunities.js → per-user hide/unhide       │   │
│  │  ├─ summary-cache.js   → AI summary cache (Vertex AI)    │   │
│  │  └─ preferences.js     → generic key/value prefs         │   │
│  └───────┬───────────────────────────────┬───────────────────┘   │
│          │                               │                       │
│  ┌───────▼───────────────┐   ┌──────────▼──────────────────┐   │
│  │ snowflake-connection.js│   │ db/index.js (pg Pool)        │   │
│  │ snowflake-queries.js   │   │                              │   │
│  └───────┬───────────────┘   └──────────┬──────────────────┘   │
└──────────┼───────────────────────────────┼───────────────────────┘
           │                               │
┌──────────▼──────────┐         ┌──────────▼──────────┐
│   Snowflake Cloud    │         │  Postgres (local)     │
│   FOUNDATIONAL.      │         │  users, sessions,      │
│   CUSTOMER schema    │         │  user_preferences,      │
│   (SC opp data)       │         │  hidden_opportunities,  │
│                      │         │  sc_opportunities_cache,│
│                      │         │  opportunity_summaries  │
└──────────────────────┘         └─────────────────────┘
```

## Two ways to run it

- **`npm start`** (`node index.js`) — the real server. Serves the pre-built `dist/` bundle and every `/api/*` route, backed by live Snowflake + Postgres. This is what runs in production.
- **`npm run dev`** (`vite --config vite.config.spa.ts`) — a Vite dev server for the UI only, with hot module reload. It has no backend of its own; `server.proxy` in `vite.config.spa.ts` forwards every `/api/*` request to `npm start` on port 8080. Run both at once: `npm start` in one terminal, `npm run dev` in another.

There is no SSR server function layer — that was an earlier iteration of this app (TanStack Start `createServerFn`s) that was converted away from; see `CONVERSION_SUMMARY.md`. All backend logic lives in `index.js` and its `routes/`, `services/`, `middleware/`, `db/` modules.

## Data flow: fetching "my opportunities"

1. **Auth** — `middleware/auth.js` resolves `req.user` from Pomerium headers (production) or a `DEV_MODE` bypass (local dev, `DEV_USER_EMAIL`/`devEmailOverride`), upserting into Postgres `users`.
2. **SC identity** — `services/sc-lookup.js` resolves the effective Sales Engineer email (a saved `salesEngineerEmail` preference, else `req.user`'s email) to a Snowflake `USER_ID` via `USER_HISTORY`.
3. **Scope** — `services/opp-scope.js` resolves ARR threshold + close-date window from the saved `oppScopeSettings` preference, falling back to computed defaults (`fiscal-quarter.js`).
4. **Cache check** — `services/sc-opportunities-cache.js` checks `sc_opportunities_cache` (Postgres) for a fresh (≤12hr) entry for this user; returns it if present.
5. **Cache miss** — builds a scoped SQL query (`snowflake-queries.js`, `buildScOpportunitiesQuery`), runs it (`snowflake-connection.js`, `executeQuery`), transforms rows, and stores the result in Postgres before returning.
6. **Client** — `GET /api/opportunities/my-sc-opps` returns the opportunity list; the UI (`src/lib/api/sc-opportunities.ts` → `useQuery`) caches it client-side via TanStack Query.

Related endpoints follow the same shape: hide/unhide (`services/hidden-opportunities.js`), preferences CRUD (`routes/preferences.js`), AI summary generation/caching (`services/summary-cache.js` → `src/lib/vertex-ai.server.js` → Vertex AI/Gemini).

## Local dev flags (`.env`)

- `USE_MOCK_DATA=true` — bypass Snowflake, return static mock data.
- `USE_TEST_OPPS=true` — bypass SC identity/stage/ARR/close-date scoping, return a fixed opportunity ID list (`services/test-opps.js`). Set `false` to exercise real scoping against Settings values.
- `DEV_MODE=true` — bypass Pomerium auth using `DEV_USER_EMAIL`, with a `/api/dev/session-email` endpoint (surfaced in Settings) to switch identity without real SSO.

## File organization

```
index.js                     # Express app: routes, health check, static serving
routes/preferences.js        # User-preferences REST routes
services/                    # Backend business logic (see diagram above)
middleware/                  # Session + auth
db/index.js                  # Postgres pool + schema init
snowflake-connection.js      # Snowflake SDK wrapper
snowflake-queries.js         # SQL builders

src/
├── main.tsx                 # SPA entry — mounts the router into index.html's #root
├── router.tsx                # TanStack Router + QueryClient setup
├── routeTree.gen.ts          # Auto-generated by the tanstackRouter() vite plugin
├── routes/
│   ├── __root.tsx            # Shared layout (QueryClientProvider, head tags)
│   ├── opportunities.tsx      # Main opportunities view
│   ├── settings.tsx           # Preferences, opp-scope, dev tools
│   ├── admin.tsx               # Health monitoring dashboard
│   └── index.tsx                # Pipeline dashboard
├── lib/
│   ├── opportunities.ts       # Shared types + mock data
│   ├── api/                    # fetch() wrappers calling index.js's /api/* routes
│   └── vertex-ai.server.js    # Imported by services/summary-cache.js (Express-only)
└── components/                # UI components
```

## Security

- Credentials only ever read from environment variables, never sent to the client.
- Parameterized/escaped SQL in both `snowflake-queries.js` and Postgres queries (`pg` uses `$1`/`$2` placeholders).
- Session cookie (`se.opp.sid`) backed by Postgres via `connect-pg-simple`.
- `DEV_MODE` and `USE_TEST_OPPS` are local-dev-only escape hatches — must be `false`/unset in production.
