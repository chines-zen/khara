# Quick Start: Snowflake Connection

This is a condensed guide to get your Snowflake connection working quickly.

## 1. Install Package (Choose one)

```bash
npm install snowflake-sdk
# or
bun add snowflake-sdk
# or
pnpm add snowflake-sdk
```

## 2. Create `.env` File

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
SNOWFLAKE_ACCOUNT=your_account.region
SNOWFLAKE_USERNAME=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_DATABASE=SE_OPP_RIGOR
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_ROLE=SYSADMIN
```

## 3. Set Up Snowflake Tables

Run these SQL commands in Snowflake:

### Option A: Quick Test (Small Dataset)
```sql
-- Run the complete schema
-- File: snowflake-schema.sql
```

### Option B: Production (Full Mock Data)
```sql
-- Run both schema and migration
-- Files: snowflake-schema.sql + migrate-mock-data.sql
```

## 4. Test the Connection

Create a test file:

```typescript
// test-connection.ts
import { querySnowflake } from "./src/lib/snowflake.server";

querySnowflake({
  query: "SELECT COUNT(*) as count FROM opportunities"
})
  .then(result => console.log("✅ Connected!", result))
  .catch(error => console.error("❌ Failed:", error));
```

Run:
```bash
tsx test-connection.ts
# or
node --loader tsx test-connection.ts
```

## 5. Update Your Frontend (Optional - for production use)

When ready to switch from mock data to Snowflake:

1. See example: [src/routes/opportunities.snowflake-example.tsx](src/routes/opportunities.snowflake-example.tsx)
2. Key changes:
   - Add `useQuery` hook
   - Call `getOpportunities()` server function
   - Add loading and error states
   - Update disclaimer text

## Files Created

✅ **Backend:**
- `src/lib/snowflake.server.ts` - Connection utilities
- `src/lib/api/opportunities.functions.ts` - Server functions
- `src/lib/config.server.ts` - Updated with Snowflake config

✅ **Database:**
- `snowflake-schema.sql` - Table schema
- `migrate-mock-data.sql` - Sample data loader

✅ **Config:**
- `.env.example` - Environment template
- `.gitignore` - Security

✅ **Documentation:**
- `SNOWFLAKE_SETUP.md` - Complete guide
- `QUICK_START.md` - This file

✅ **Examples:**
- `src/routes/opportunities.snowflake-example.tsx` - Frontend integration

## Architecture

```
┌─────────────────┐
│  React Client   │
│  (Browser)      │
└────────┬────────┘
         │
         │ useQuery()
         │
┌────────▼────────────────────────┐
│  Server Functions               │
│  opportunities.functions.ts     │
└────────┬────────────────────────┘
         │
         │ querySnowflake()
         │
┌────────▼────────────────────────┐
│  Snowflake Client               │
│  snowflake.server.ts            │
└────────┬────────────────────────┘
         │
         │ SQL Query
         │
┌────────▼────────────────────────┐
│  Snowflake Database             │
│  ├─ opportunities table         │
│  └─ v_opportunities_formatted   │
└─────────────────────────────────┘
```

## Troubleshooting

### "Cannot find module 'snowflake-sdk'"
→ Run the install command again

### "Invalid account"
→ Format should be `account.region` (e.g., `xy12345.us-east-1`)

### "Object does not exist"
→ Run `snowflake-schema.sql` first

### "Authentication failed"
→ Double-check username/password in `.env`

## Next Steps

1. ✅ Install `snowflake-sdk`
2. ✅ Configure `.env`
3. ✅ Run SQL schema
4. ✅ Test connection
5. ⏭️ Load your real Salesforce data
6. ⏭️ Update frontend to use Snowflake data
7. ⏭️ Deploy to production

## Getting Help

- Snowflake SDK: https://docs.snowflake.com/en/user-guide/nodejs-driver
- TanStack Query: https://tanstack.com/query/latest
- Full setup guide: See [SNOWFLAKE_SETUP.md](SNOWFLAKE_SETUP.md)
