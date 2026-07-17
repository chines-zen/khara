# Snowflake Integration Setup

This guide will help you connect your SE Opportunity Rigor application to Snowflake.

## Prerequisites

- A Snowflake account with appropriate permissions
- Node.js package manager (npm, bun, pnpm, or yarn)
- Access to a Snowflake warehouse, database, and schema

## Installation Steps

### 1. Install Dependencies

```bash
# Using npm
npm install snowflake-sdk

# OR using bun
bun add snowflake-sdk

# OR using pnpm
pnpm add snowflake-sdk

# OR using yarn
yarn add snowflake-sdk
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your Snowflake credentials:

```env
SNOWFLAKE_ACCOUNT=xy12345.us-east-1
SNOWFLAKE_USERNAME=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_DATABASE=SE_OPP_RIGOR
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_ROLE=SYSADMIN
```

**Important:** Never commit `.env` to version control. Make sure it's in your `.gitignore` file.

### 3. Set Up Snowflake Schema

Run the SQL commands in `snowflake-schema.sql` in your Snowflake account:

```bash
# Option 1: Use Snowflake Web UI
# - Open Snowflake UI
# - Navigate to Worksheets
# - Paste the contents of snowflake-schema.sql
# - Execute the SQL

# Option 2: Use SnowSQL CLI
snowsql -f snowflake-schema.sql
```

This will create:
- `opportunities` table with the correct schema
- Indexes for performance
- A formatted view `v_opportunities_formatted`
- Sample data (optional - can be modified)

### 4. Load Your Data

You have several options to load your Salesforce data into Snowflake:

#### Option A: Manual CSV Import

1. Export opportunities from Salesforce as CSV
2. Use Snowflake's COPY INTO command:

```sql
COPY INTO opportunities
FROM @my_stage/opportunities.csv
FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1);
```

#### Option B: Salesforce Connector

Use Snowflake's native Salesforce connector to sync data automatically.

#### Option C: ETL Tool

Use tools like Fivetran, Airbyte, or dbt to sync Salesforce to Snowflake.

### 5. Update the Frontend to Use Real Data

The application currently uses mock data from `src/lib/opportunities.ts`. To switch to Snowflake data, update `src/routes/opportunities.tsx`:

#### Current (Mock Data):
```tsx
import { OPPORTUNITIES } from "@/lib/opportunities";

// ...
const filtered = useMemo(() => applyFilters(filters), [filters]);
```

#### Updated (Snowflake Data):
```tsx
import { getOpportunities } from "@/lib/api/opportunities.functions";
import { useQuery } from "@tanstack/react-query";

function OpportunitiesPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  
  // Fetch opportunities from Snowflake
  const { data: opportunities = [], isLoading } = useQuery({
    queryKey: ['opportunities', filters],
    queryFn: () => getOpportunities({ data: filters }),
  });

  // ... rest of component
}
```

## Architecture

### Files Created

- **`src/lib/snowflake.server.ts`** - Snowflake connection and query utilities
- **`src/lib/api/opportunities.functions.ts`** - Server functions to fetch data
- **`snowflake-schema.sql`** - Database schema definition
- **`.env.example`** - Example environment configuration

### Data Flow

```
Frontend (React)
    ↓
TanStack Query
    ↓
Server Functions (opportunities.functions.ts)
    ↓
Snowflake Client (snowflake.server.ts)
    ↓
Snowflake Database
```

### Security

- All Snowflake credentials are stored in environment variables
- The `.server.ts` suffix ensures server-only code never reaches the client
- Connection credentials are never exposed to the browser

## Schema Mapping

The Snowflake table structure matches your prototype's data model:

| Snowflake Column | Type | TypeScript Field | Description |
|-----------------|------|------------------|-------------|
| `id` | VARCHAR | `id` | Unique opportunity ID |
| `name` | VARCHAR | `name` | Opportunity name |
| `account` | VARCHAR | `account` | Account name |
| `stage` | VARCHAR | `stage` | Sales stage |
| `amount` | NUMBER | `amount` | Deal amount |
| `close_date` | DATE | `closeDate` | Expected close date |
| `owner` | VARCHAR | `owner` | Sales owner |
| `sc_notes` | TEXT | `scNotes` | Solutions consultant notes |
| `next_steps` | VARIANT | `nextSteps` | JSON array of next steps |
| `manager_notes` | TEXT | `managerNotes` | Manager notes |
| `sc_manager_notes` | TEXT | `scManagerNotes` | SC manager notes |
| `d_score` | NUMBER | `dScore` | Deal health score (0-100) |
| `recent_d_score_date` | DATE | `recentDScoreDate` | Last score update date |
| `d_score_delta` | NUMBER | `dScoreDelta` | Score change |

## Testing the Connection

Create a simple test file to verify your Snowflake connection:

```typescript
// test-snowflake.ts
import { querySnowflake } from "./src/lib/snowflake.server";

async function testConnection() {
  try {
    const result = await querySnowflake({
      query: "SELECT COUNT(*) as count FROM opportunities",
    });
    console.log("Connection successful!", result);
  } catch (error) {
    console.error("Connection failed:", error);
  }
}

testConnection();
```

Run it with:
```bash
tsx test-snowflake.ts
```

## Performance Optimization

### Indexes

The schema includes indexes on commonly filtered fields:
- `stage`
- `owner`
- `close_date`
- `d_score`

### Query Optimization

- Server-side filtering reduces data transfer
- Parameterized queries prevent SQL injection
- Connection pooling can be added for high-traffic scenarios

### Caching

Consider adding caching with TanStack Query's built-in cache:

```tsx
const { data: opportunities } = useQuery({
  queryKey: ['opportunities', filters],
  queryFn: () => getOpportunities({ data: filters }),
  staleTime: 5 * 60 * 1000, // Cache for 5 minutes
});
```

## Troubleshooting

### Connection Errors

**Error: "Cannot find module 'snowflake-sdk'"**
- Make sure you've run the install command
- Restart your development server

**Error: "Invalid account"**
- Check your `SNOWFLAKE_ACCOUNT` format
- Should be: `account_identifier.region` (e.g., `xy12345.us-east-1`)

**Error: "Authentication failed"**
- Verify your username and password
- Check if your Snowflake user has the correct permissions

### Query Errors

**Error: "Object does not exist"**
- Make sure you've created the table using `snowflake-schema.sql`
- Verify the database and schema names in your `.env`

**Error: "Insufficient privileges"**
- Your Snowflake role needs SELECT permission on the opportunities table
- Contact your Snowflake administrator

## Next Steps

1. Set up automated data sync from Salesforce to Snowflake
2. Add more analytics queries (trends, forecasting, etc.)
3. Implement real-time updates with Snowflake Streams
4. Add data validation and error handling
5. Set up monitoring and alerting for data freshness

## Additional Resources

- [Snowflake SDK Documentation](https://docs.snowflake.com/en/user-guide/nodejs-driver)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [TanStack Start Documentation](https://tanstack.com/start/latest)
