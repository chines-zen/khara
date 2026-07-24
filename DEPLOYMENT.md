# Deployment & Local Setup

The app is a single Express server (`index.js`) that serves a pre-built React
bundle from `dist/` and handles Snowflake queries, Postgres-backed
caching/preferences/sessions, and auth. See [ARCHITECTURE.md](ARCHITECTURE.md)
for the full design.

## Prerequisites

- **Node.js** 20+ and **npm**
- **PostgreSQL** 14+ running and reachable (stores sessions, preferences, and
  the cached Snowflake data). Tables are created automatically on first server
  startup by `db/index.js`.
- **Snowflake access** — the app queries Snowflake under each user's identity
  via `EXTERNALBROWSER` SSO (a browser window opens on first query). There is no
  offline data mode; the server always queries Snowflake.

## Setup

### 1. Install dependencies

```bash
npm install
```

This installs everything, including `snowflake-sdk` and `pg`.

### 2. Configure environment

```bash
cp .env.example .env
```

Then edit `.env`. Key settings (see `.env.example` for the annotated full list):

```bash
# Snowflake (leave USERNAME/PASSWORD unset to use EXTERNALBROWSER SSO)
SNOWFLAKE_ACCOUNT=your_account.region
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_DATABASE=...
SNOWFLAKE_SCHEMA=...
SNOWFLAKE_ROLE=...

# Postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=se_opp_rigor
DB_USER=postgres
DB_PASSWORD=

# Session
SESSION_SECRET=change-this-to-a-long-random-string

# Local dev flags — set all to false/unset in production
DEV_MODE=true              # bypass auth for local testing
ACTIVITIES_ENABLED=false   # requires SA_ACTIVITY_DAILY_SNAPSHOT access
```

Create the Postgres database first if it doesn't exist:

```bash
createdb se_opp_rigor
```

### 3. Build the frontend

```bash
npm run build
```

Outputs the client bundle to `dist/`.

### 4. Start the server

```bash
npm start            # serves dist/ + /api on PORT (default 8080)
```

Open http://localhost:8080. The admin dashboard at `/admin` shows Snowflake and
Postgres connection health.

## Local UI development

`npm start` serves the pre-built bundle, so `src/` edits won't show until you
rebuild. For live iteration, run Express in one terminal (`npm start`) and the
Vite dev server in another — it proxies `/api/*` to Express on 8080:

```bash
npm run dev          # http://localhost:3000, hot reload
```

## Deploying to a platform

Any platform that can run `node index.js` works. Ship:

- `index.js` and the backend modules (`routes/`, `services/`, `middleware/`,
  `db/`, `snowflake-*.js`)
- `package.json`
- the built `dist/` directory (run `npm run build` first)

The platform then runs `npm install` and `node index.js`. Set the same
environment variables from `.env` in the platform's config, and make sure a
Postgres instance is reachable.

**Production checklist:**

- `DEV_MODE=false` (or unset) and `USE_TEST_OPPS=false`
- `SNOWFLAKE_AUTH_USER` unset, so each user authenticates under their own RBAC
- a strong, unique `SESSION_SECRET`
- Snowflake and Postgres credentials provided as platform env vars

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module 'express'` | `npm install` |
| `dist folder not found` | `npm run build` |
| Port already in use | `PORT=8081 npm start` |
| Postgres connection errors | Verify the DB is running and `DB_*` vars are correct; check `/admin` |
| Snowflake connection failed | Check account format (`account_id.region`), role, and network/IP allowlist; check `/admin` |
