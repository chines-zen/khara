# SE Opportunity Rigor

A modern sales opportunity management application with real-time Salesforce data via Snowflake integration.

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

### Production (with Snowflake)
See [QUICK_START.md](QUICK_START.md) for Snowflake setup instructions.

## 📁 Project Structure

```
se-opp-rigor/
├── index.js                 # The one server: Express, Snowflake, Postgres, auth
├── routes/, services/, middleware/, db/   # Express backend modules
├── src/
│   ├── routes/              # Page components (built into dist/ by vite.config.spa.ts)
│   │   ├── opportunities.tsx    # Main opportunities view
│   │   └── admin.tsx            # System health dashboard
│   ├── lib/api/              # Client-side fetch() wrappers calling index.js's /api/* routes
│   └── components/          # Reusable UI components
├── snowflake-schema.sql     # Database schema
├── migrate-mock-data.sql    # Sample data
└── .env.example             # Configuration template
```

## 🎯 Features

### Current Features
- ✅ View and filter sales opportunities
- ✅ Search by name, account, or owner
- ✅ Filter by stage, owner, close month
- ✅ Sort by close date, amount, or staleness
- ✅ Detailed opportunity view with notes
- ✅ D-Score health tracking
- ✅ Responsive design

### Snowflake Integration (Ready to Enable)
- ✅ Real-time data from Snowflake
- ✅ Server-side filtering and querying
- ✅ Connection health monitoring
- ✅ Database statistics dashboard
- ✅ Automatic caching (5-minute default)
- ✅ Error handling and retry logic

## 📊 Data Model

### Opportunity Fields
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., OPP-94821) |
| `name` | string | Opportunity name |
| `account` | string | Customer account name |
| `stage` | enum | Sales stage (7 stages) |
| `amount` | number | Deal value in USD |
| `closeDate` | string | Expected close date (ISO) |
| `owner` | string | Sales rep owner |
| `scNotes` | string | Solutions consultant notes |
| `nextSteps` | string[] | Action items |
| `managerNotes` | string | Manager commentary |
| `scManagerNotes` | string | SC manager notes |
| `dScore` | number | Deal health score (0-100) |
| `recentDScoreDate` | string | Last score update date |
| `dScoreDelta` | number | Score change |

### Sales Stages
1. Prospecting
2. Qualification
3. Proposal
4. Negotiation
5. Closed Won
6. Closed Lost

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
```

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
-- Loads 20 sample opportunities
```

### 3. Verify Setup
```bash
# Visit http://localhost:8080/admin (or :3000 under npm run dev)
# Check connection status and statistics
```

## 📚 Documentation

- **[QUICK_START.md](QUICK_START.md)** - Fast setup guide (5 steps)
- **[SNOWFLAKE_SETUP.md](SNOWFLAKE_SETUP.md)** - Complete integration guide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture & diagrams
- **[SNOWFLAKE_INTEGRATION_SUMMARY.md](SNOWFLAKE_INTEGRATION_SUMMARY.md)** - Implementation summary

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
- **Databases:** Snowflake (opportunity data), Postgres (sessions, preferences, caching)
- **Icons:** Lucide React
- **Package Manager:** npm

## 🔐 Security

- ✅ All credentials stored in environment variables
- ✅ `.server.js` files are only ever imported by `index.js`, never bundled into the client
- ✅ Parameterized queries prevent SQL injection
- ✅ `.gitignore` prevents credential commits
- ✅ No sensitive data sent to client

## 🚀 Deployment

Deploy `index.js`, `package.json`, and the built `dist/` directory to any platform that runs `node index.js` (e.g. `npm run build && npm start`). See [DEPLOYMENT.md](DEPLOYMENT.md) for details.

**Don't forget:** Add your Snowflake and Postgres credentials as environment variables in your deployment platform!

## 📈 Monitoring

### Admin Dashboard
Visit `/admin` to monitor:
- Snowflake connection health
- Query latency
- Database statistics
- Opportunity counts by stage/owner
- Total pipeline value

### Performance
- Client-side caching (5 min default)
- Database indexes on key fields
- Server-side filtering reduces data transfer
- TanStack Query handles retry logic

## 🤝 Contributing

This is a prototype/demo project. For production use:

1. Add authentication (e.g., Clerk, Auth0)
2. Implement role-based access control
3. Add rate limiting
4. Set up monitoring (Sentry, DataDog)
5. Add comprehensive testing
6. Set up CI/CD pipeline

## 📝 License

Private/Proprietary - Not for redistribution

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

### Application still shows mock data
Set `USE_MOCK_DATA=false` in `.env` (see `services/` for the Snowflake-backed query paths `index.js` uses).

## 🎓 Learning Resources

- [TanStack Router Docs](https://tanstack.com/router/latest)
- [TanStack Query Docs](https://tanstack.com/query/latest)
- [Snowflake Node.js Driver](https://docs.snowflake.com/en/user-guide/nodejs-driver)
- [Tailwind CSS](https://tailwindcss.com)
- [Radix UI](https://www.radix-ui.com)

## 🗺️ Roadmap

### Phase 1: Core Features (Current)
- ✅ Opportunity list and detail views
- ✅ Filtering and search
- ✅ Snowflake integration ready

### Phase 2: Data Integration (Next)
- ⏭️ Connect to production Snowflake
- ⏭️ Real-time Salesforce sync
- ⏭️ Data validation and error handling

### Phase 3: Advanced Features
- ⏭️ Analytics and reporting
- ⏭️ Trend analysis
- ⏭️ Forecast modeling
- ⏭️ Email notifications
- ⏭️ Export to CSV/PDF

### Phase 4: Team Features
- ⏭️ User authentication
- ⏭️ Role-based permissions
- ⏭️ Collaboration tools
- ⏭️ Activity logging

## 📬 Support

For questions or issues:
1. Check the documentation files
2. Review the `/admin` dashboard for diagnostics
3. Check browser console for client errors
4. Check server logs for backend errors

---

**Built with ❤️ using Claude Code**
