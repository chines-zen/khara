# SE Opportunity Rigor

A sales opportunity tracking app for Solutions Consultants — surfaces their scoped Salesforce pipeline (via Snowflake), tracks D-Score deal health, and lets SCs/managers layer notes on top.

Built with React, Vite, and Tailwind CSS on the frontend, and a single Express server (`index.js`) on the backend — handling Snowflake queries, Postgres-backed caching/preferences/sessions, and Pomerium auth. There is exactly one server; see [ARCHITECTURE.md](ARCHITECTURE.md).

## 🚀 Quick Start

> **First time on a fresh clone?** Do [Local Setup](#️-local-setup) first
> (`.env` + `createdb`) — the commands below assume both are already in place.

### Run the app
```bash
# Install dependencies
npm install

# Build the frontend and start the one real server (Express + Snowflake + Postgres)
npm run build
npm start

# Open http://localhost:8080
```

### Iterate on the UI with hot reload
`npm start` serves a pre-built bundle, so it won't reflect `src/` edits until you rebuild. For live UI iteration, run the Express server in one terminal (as above) and a Vite dev server in another — it proxies `/api/*` to Express on port 8080:
```bash
npm run dev
# Open http://localhost:3000
```

### Local dev flags
The server always queries Snowflake — there is no offline data mode. For local dev you can set `DEV_MODE=true` to bypass Pomerium auth, and `USE_TEST_OPPS=true` to bypass SC scoping and pull the fixed opportunity set in `services/test-opps.js`. See [ARCHITECTURE.md](ARCHITECTURE.md#local-dev-flags-env) for all local dev flags.

## 📁 Project Structure

```
se-opp-rigor/
├── index.js                 # The one server: Express, Snowflake, Postgres, auth
├── routes/, services/, middleware/, db/   # Express backend modules
├── snowflake-connection.js, snowflake-queries.js  # Snowflake SDK wrapper + SQL builders
├── src/
│   ├── routes/              # Page components (built into dist/ by vite.config.spa.ts)
│   │   ├── index.tsx            # Pipeline dashboard (KPIs, stage chart)
│   │   ├── opportunities.tsx    # Main opportunity list + detail view
│   │   ├── settings.tsx         # Preferences, opp-scope, dev tools
│   │   └── admin.tsx            # System health & stats dashboard
│   ├── lib/api/              # Client-side fetch() wrappers calling index.js's /api/* routes
│   └── components/opportunities/  # Opportunity list/detail/nav UI components
└── .env.example             # Configuration template
```

## 🎯 Features

- View, search, and filter opportunities by stage, owner, and close month
- Sort by close date, amount, or staleness
- Detailed opportunity view with SC notes, manager notes, and next steps
- D-Score deal health tracking, with an AI-generated summary of recent notes (Claude, via Zendesk's internal AI gateway)
- Hide/unhide opportunities per user
- Pipeline dashboard with KPIs and a stage breakdown chart
- Per-user opportunity scope (ARR threshold + close-date window) and preferences (name, date format, timezone)
- Server-side Snowflake scoping by SC identity, with a 12-hour Postgres cache
- Admin dashboard for Snowflake/Postgres connection health and pipeline stats

## 📊 Data Model

### Opportunity Fields
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., OPP-94821) |
| `name` | string | Opportunity name |
| `account` | string | Customer account name |
| `stage` | string | Sales stage (values come from the data) |
| `amount` | number | Deal value in USD |
| `closeDate` | string | Expected close date (ISO) |
| `owner` | string | Sales rep owner |
| `scNotes` | string | Solutions consultant notes |
| `nextSteps` | string[] | Action items |
| `managerNotes` | string | Manager commentary |
| `scManagerNotes` | string | SC manager notes |
| `dScore` | number | Deal health score (0-100) |
| `lastUpdateDate` | string \| null | Most recent date mentioned in SC Notes |
| `dScoreDelta` | number | Score change |


## 🗄️ Local Setup

A fresh clone (no `.env`, no database) needs these steps in order. See
[DEPLOYMENT.md](DEPLOYMENT.md) for the same steps with more detail.

### 1. Configure environment
```bash
cp .env.example .env
# then edit .env — fill in DEV_USER_EMAIL 
```

**Important:** Never commit `.env` to version control!

### 2. Create the Postgres database
```bash
createdb se_opp_rigor   # must match DB_NAME in .env
```
`pg` connects to an existing database — it won't create one. If it's missing,
startup fails with a connection error. The **tables** inside it are created
automatically on first server startup by `db/index.js` (users, sessions,
user_preferences, hidden_opportunities, sc_opportunities_cache,
opportunity_summaries, activities, dispassionate_reviews) — no manual SQL or
migrations needed.

### 3. Install, build, and start
```bash
npm install
npm run build
npm start        # http://localhost:8080
```

### 4. Verify
Visit `http://localhost:8080/admin` to check
Snowflake/Postgres connection status and statistics.

> **Snowflake tables:** this app *reads* existing Zendesk Snowflake data — you do
> not create any Snowflake tables for local dev.

## 📚 Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture, data flow, and local dev flags
- **[SNOWFLAKE_DATA_MODEL.md](SNOWFLAKE_DATA_MODEL.md)** - The Snowflake tables/fields this app reads, and patterns for building your own Snowflake-backed app
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Deploying to a hosted platform (local setup lives in this README)

## 🛠️ Development

### Available Scripts

```bash
# Vite dev server for the UI, hot reload, proxies /api/* to npm start on :8080
npm run dev

# Build the frontend (outputs to dist/, served by index.js)
npm run build

# The one real server: Express + Snowflake + Postgres + auth, serves dist/
npm start

# Lint code
npm run lint

# Format code
npm run format
```

### Tech Stack

- **Frontend:** React + TanStack Router/Query, Vite, TypeScript
- **Backend:** Express (`index.js`) — the only server
- **Styling:** Tailwind CSS 4
- **UI Components:** Radix UI
- **Charts:** Recharts
- **Databases:** Snowflake (opportunity data), Postgres (sessions, preferences, caching)
- **AI:** Claude (via Zendesk's internal Bedrock-compatible AI gateway) for opportunity note summaries
- **Icons:** Lucide React
- **Package Manager:** npm

## 🔐 Security

- All credentials stored in environment variables
- `.server.js` files are only ever imported by `index.js`, never bundled into the client
- Parameterized queries prevent SQL injection
- `.gitignore` prevents credential commits
- No sensitive data sent to client
- `DEV_MODE` and `USE_TEST_OPPS` are local-dev-only escape hatches — must be `false`/unset in production

## 🚀 Deployment

Deploy `index.js`, `package.json`, and the built `dist/` directory to any platform that runs `node index.js` (e.g. `npm run build && npm start`). See [DEPLOYMENT.md](DEPLOYMENT.md) for details.

**Don't forget:** Add your Snowflake and Postgres credentials as environment variables in your deployment platform!

## 📈 Monitoring

### Admin Dashboard
Visit `/admin` to monitor:
- Snowflake and Postgres connection health
- Pipeline statistics (opportunity counts, total pipeline value, stages, owners)

## 🆘 Troubleshooting

### "Cannot find module ..."
Run `npm install` — all dependencies (including `snowflake-sdk` and `pg`) are in `package.json`.

### "Connection failed"
1. Verify credentials in `.env`
2. Check `/admin` for detailed error
3. Ensure Snowflake account is accessible
4. Check network policies/IP allowlists

### "relation does not exist" (Postgres)
App tables are created automatically on startup by `db/index.js`. This usually means the database itself is missing — run `createdb se_opp_rigor` (matching `DB_NAME`), then restart. The app never creates Snowflake tables; it reads existing Zendesk Snowflake data.

## 📝 License

Private/Proprietary - Not for redistribution
