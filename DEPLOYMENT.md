# Deployment

Deploying the app to a hosted platform. For **local setup** (cloning, `.env`,
`createdb`, running the dev server), see the [Local Setup](README.md#️-local-setup)
section of the README. For the full system design, see
[ARCHITECTURE.md](ARCHITECTURE.md).

The app is a single Express server (`index.js`) that serves a pre-built React
bundle from `dist/` and handles Snowflake queries, Postgres-backed
caching/preferences/sessions, and auth.

## Prerequisites

- **Node.js** 20+ on the platform.
- **PostgreSQL** 14+ reachable from the app (stores sessions, preferences, and
  cached Snowflake data). Tables are created automatically on first server
  startup by `db/index.js`; the database itself must already exist.
- **Snowflake access** — the app queries Snowflake under each user's identity
  via `EXTERNALBROWSER` SSO. There is no offline data mode; the server always
  queries Snowflake.

## Deploying to a platform

Any platform that can run `node index.js` works. Build the frontend first
(`npm run build`), then ship:

- `index.js` and the backend modules (`routes/`, `services/`, `middleware/`,
  `db/`, `snowflake-*.js`)
- `package.json`
- the built `dist/` directory

The platform then runs `npm install` and `node index.js` (serves `dist/` + `/api`
on `PORT`, default 8080). Set the same environment variables from `.env` in the
platform's config (see the [Configuration](README.md#-configuration) section of
the README for the full list), and make sure a Postgres instance is reachable.

## Production checklist

- `DEV_MODE=false` (or unset)
- `SNOWFLAKE_AUTH_USER` unset, so each user authenticates under their own RBAC
- a strong, unique `SESSION_SECRET`
- Snowflake and Postgres credentials provided as platform env vars

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module 'express'` | `npm install` |
| `dist folder not found` | `npm run build` |
| Port already in use | `PORT=8081 npm start` |
| Postgres connection errors | Verify the DB is running and reachable and `DB_*` vars are correct; check `/admin` |
| Snowflake connection failed | Check account format, role, and network/IP allowlist; check `/admin` |
