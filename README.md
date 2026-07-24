# SE Opportunity Rigor

A sales opportunity tracking app for Solutions Consultants — surfaces their scoped Salesforce pipeline (via Snowflake), tracks D-Score deal health, and lets SCs/managers layer notes on top.

Built with React, Vite, and Tailwind CSS on the frontend, and a single Express server (`index.js`) on the backend — handling Snowflake queries, Postgres-backed caching/preferences/sessions, and Pomerium auth. There is exactly one server; see [ARCHITECTURE.md](ARCHITECTURE.md).

## 🚀 Quick Start

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
├── snowflake-schema.sql     # Database schema
├── migrate-mock-data.sql    # Sample data
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
| `stage` | enum | Sales stage (6 stages) |
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

### Sales Stages
1. Prospecting
2. Qualification
3. Proposal
4. Negotiation
5. Won
6. Lost

## 🔧 Configuration

### Environment Variables

Create a `.env` file (copy from `.env.example`):

```env
# Snowflake credentials
SNOWFLAKE_ACCOUNT=your_account.region
SNOWFLAKE_USERNAME=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_DATABASE=SE_OPP_RIGOR
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_ROLE=SYSADMIN

# Postgres (sessions, preferences, caching)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=se_opp_rigor
DB_USER=postgres
DB_PASSWORD=

# Local dev flags — see ARCHITECTURE.md for details
USE_TEST_OPPS=false
DEV_MODE=true
DEV_USER_EMAIL=your_email@zendesk.com
```

See `.env.example` for the full list, including the AI gateway (`AWS_ENDPOINT_URL_BEDROCK_RUNTIME` / `AWS_BEARER_TOKEN_BEDROCK`) and session (`SESSION_SECRET`) settings.

**Important:** Never commit `.env` to version control!

## 🗄️ Database Setup

### 1. Create Snowflake Tables
```sql
-- Run snowflake-schema.sql in your Snowflake account
-- Creates: opportunities table + indexes + view
```

### 2. Load Sample Data (Optional)
```sql
-- Run migrate-mock-data.sql
-- Loads sample opportunities
```

### 3. Postgres Tables
Created automatically on server startup by `db/index.js` (users, sessions, user_preferences, hidden_opportunities, sc_opportunities_cache, opportunity_summaries).

### 4. Verify Setup
```bash
# Visit http://localhost:8080/admin (or :3000 under npm run dev)
# Check connection status and statistics
```

## 📚 Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture, data flow, and local dev flags
- **[SNOWFLAKE_DATA_MODEL.md](SNOWFLAKE_DATA_MODEL.md)** - The Snowflake tables/fields this app reads, and patterns for building your own Snowflake-backed app
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Deployment guide

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

### "Cannot find module 'snowflake-sdk'"
```bash
npm install snowflake-sdk
```

### "Invalid Snowflake account"
Check that your account format is: `account_id.region`
Example: `xy12345.us-east-1`

### "Connection failed"
1. Verify credentials in `.env`
2. Check `/admin` for detailed error
3. Ensure Snowflake account is accessible
4. Check network policies/IP allowlists

### "Table does not exist"
Run `snowflake-schema.sql` in Snowflake to create tables

## 📝 License

Private/Proprietary - Not for redistribution
