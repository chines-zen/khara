import pg from "pg";
const { Pool } = pg;

// PostgreSQL connection pool
export const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on("connect", () => {
  console.log("✅ PostgreSQL pool connected");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error:", err);
});

/**
 * Initialize database tables on startup
 * Creates tables if they don't exist (idempotent)
 */
export async function initializeDatabase() {
  const client = await pool.connect();

  try {
    console.log("📦 Initializing database tables...");

    await client.query("BEGIN");

    // Users table - store SSO user info
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        sub VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP DEFAULT NOW()
      )
    `);

    // Index on email for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);

    // is_manager: NULL until determined from Snowflake (has direct reports),
    // then cached so we don't re-check on every login.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_manager BOOLEAN
    `);

    // sfdc_user_id: the user's Snowflake/Salesforce USER_ID from USER_HISTORY,
    // resolved once alongside is_manager and cached here. This is what scopes
    // the opportunity/activity queries, so persisting it keeps a cache refresh
    // to a single Snowflake call instead of re-resolving the identity first.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS sfdc_user_id VARCHAR(255)
    `);

    // When the identity lookup last succeeded. Both cached values above are
    // refreshed together once this goes stale, so a re-provisioned USER_ID or a
    // promotion/demotion is eventually picked up rather than cached forever.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_resolved_at TIMESTAMP
    `);

    // User preferences table - store filter defaults, saved views
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        preference_key VARCHAR(255) NOT NULL,
        preference_value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, preference_key)
      )
    `);

    // Index on user_id for fast preference lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_preferences_user_id ON user_preferences(user_id)
    `);

    // Opportunity summaries table - cache Vertex AI summaries indefinitely
    await client.query(`
      CREATE TABLE IF NOT EXISTS opportunity_summaries (
        id SERIAL PRIMARY KEY,
        opportunity_id VARCHAR(255) UNIQUE NOT NULL,
        summary TEXT NOT NULL,
        generated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Index for opportunity summaries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_summaries_opportunity_id ON opportunity_summaries(opportunity_id)
    `);

    // Session table for express-session with connect-pg-simple
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);

    // Index on expire for efficient cleanup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_session_expire ON "session"(expire)
    `);

    // Hidden opportunities table - track which opps users have hidden
    await client.query(`
      CREATE TABLE IF NOT EXISTS hidden_opportunities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        opportunity_id VARCHAR(255) NOT NULL,
        hidden_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, opportunity_id)
      )
    `);

    // Index for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hidden_opportunities_user_id ON hidden_opportunities(user_id)
    `);

    // SC opportunities cache - 12-hour TTL cache per user
    await client.query(`
      CREATE TABLE IF NOT EXISTS sc_opportunities_cache (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        snowflake_user_id VARCHAR(255) NOT NULL,
        opportunities_data JSONB NOT NULL,
        cached_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        UNIQUE(user_id)
      )
    `);

    // Scope (ARR threshold / close-date preset / SE emails) used for the most
    // recent sync, so the admin page can report what the latest successful query
    // actually covered. Added via ALTER for DBs created before this column existed.
    await client.query(`
      ALTER TABLE sc_opportunities_cache ADD COLUMN IF NOT EXISTS scope JSONB
    `);

    // Indexes for cache lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sc_cache_user_id ON sc_opportunities_cache(user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sc_cache_expires ON sc_opportunities_cache(expires_at)
    `);

    // Activities - local mirror of Snowflake's SA_ACTIVITY_DAILY_SNAPSHOT,
    // deduped to one row per activity id (see services/activities-cache.js)
    await client.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id VARCHAR(255) PRIMARY KEY,
        account_id VARCHAR(255),
        account_name VARCHAR(500),
        activity_date DATE,
        activity_month DATE,
        activity_year_quarter VARCHAR(10),
        activity_year_month VARCHAR(10),
        subject TEXT,
        type VARCHAR(100),
        sub_type VARCHAR(200),
        duration_hours NUMERIC(6,2),
        owner_id VARCHAR(255),
        owner_name VARCHAR(255),
        owner_role VARCHAR(255),
        created_by_id VARCHAR(255),
        created_by_name VARCHAR(255),
        whatid VARCHAR(255),
        whatid_type VARCHAR(50),
        activity_match_opp_name TEXT,
        activity_match_account_name TEXT,
        is_sales_activity BOOLEAN,
        source_snapshot_date DATE,
        synced_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activities_created_by_id ON activities(created_by_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activities_activity_month ON activities(activity_month)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type)
    `);

    // Tracks the last Snowflake->Postgres sync per SE (scoped by who created
    // the activity record, not who it's assigned to - see services/activities-cache.js),
    // so a manager syncing SE A's activities doesn't mark SE B's mirror rows
    // fresh too. Each created_by_id's TTL is independent, mirroring
    // sc_opportunities_cache but keyed by the mirrored SE rather than the
    // requesting app user.
    await client.query(`
      CREATE TABLE IF NOT EXISTS activities_sync_meta (
        created_by_id VARCHAR(255) PRIMARY KEY,
        last_synced_at TIMESTAMP NOT NULL
      )
    `);

    // Dispassionate reviews (D-Score history) - local mirror of Snowflake's
    // CLEANSED.SALESFORCE.SALESFORCE_DISPASSIONATE_REVIEW_C_SCD2 view. One row
    // per review record (an opportunity has multiple reviews over time). This is
    // deliberately a flat per-row mirror (like `activities`), NOT a per-user JSONB
    // blob (like sc_opportunities_cache): the intended use case is time-series -
    // comparing D-Score dimensions across reviews per opp - which needs row-level
    // SQL (sort/filter/delta), and reviews are shared reference data about an opp
    // rather than something scoped per requesting app user.
    // Score columns are the source's categorical VARCHAR values (leading digit is
    // the sub-score, e.g. "2 - 71% to 85%; ...").
    await client.query(`
      CREATE TABLE IF NOT EXISTS dispassionate_reviews (
        id VARCHAR(255) PRIMARY KEY,
        opportunity_id VARCHAR(255) NOT NULL,
        name TEXT,
        is_deleted BOOLEAN,
        created_by_id VARCHAR(255),
        last_modified_by_id VARCHAR(255),
        last_activity_date DATE,
        discovery_score TEXT,
        solution_fit_score TEXT,
        architecture_score TEXT,
        integration_score TEXT,
        security_score TEXT,
        net_value_score TEXT,
        competitiveness_score TEXT,
        partner_score TEXT,
        it_alignment_score TEXT,
        exec_goals_score TEXT,
        services_score TEXT,
        advanced_demo_score TEXT,
        testing_access_score TEXT,
        discovery_score_notes TEXT,
        solution_fit_score_notes TEXT,
        architecture_score_notes TEXT,
        integration_score_notes TEXT,
        security_score_notes TEXT,
        net_value_score_notes TEXT,
        other_competitors_score_notes TEXT,
        partner_score_notes TEXT,
        it_alignment_score_notes TEXT,
        exec_goals_score_notes TEXT,
        services_score_notes TEXT,
        advanced_demo_score_notes TEXT,
        testing_access_score_notes TEXT,
        valid_from_timestamp TIMESTAMP,
        valid_to_timestamp TIMESTAMP,
        summed_d_score INTEGER,
        synced_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // App-computed rollup: sum of the leading digit of each categorical score
    // dimension. Added via ALTER for DBs created before this column existed.
    await client.query(`
      ALTER TABLE dispassionate_reviews ADD COLUMN IF NOT EXISTS summed_d_score INTEGER
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dispassionate_reviews_opportunity_id ON dispassionate_reviews(opportunity_id)
    `);

    // Composite index for the common "history for this opp, ordered by review time" read
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dispassionate_reviews_opp_valid_from ON dispassionate_reviews(opportunity_id, valid_from_timestamp)
    `);

    // Tracks the last Snowflake->Postgres sync per opportunity so each opp's TTL
    // is independent (mirrors activities_sync_meta, keyed by opportunity_id).
    await client.query(`
      CREATE TABLE IF NOT EXISTS dispassionate_reviews_sync_meta (
        opportunity_id VARCHAR(255) PRIMARY KEY,
        last_synced_at TIMESTAMP NOT NULL
      )
    `);

    // Gong call spotlight mirror. Calls are shared across users, and a single
    // call can be linked to multiple opportunities, so the opportunity/call
    // relationship is the natural composite key.
    await client.query(`
      CREATE TABLE IF NOT EXISTS gong_calls (
        opportunity_id VARCHAR(255) NOT NULL,
        conversation_key VARCHAR(255) NOT NULL,
        call_id VARCHAR(255) NOT NULL,
        call_date DATE NOT NULL,
        title TEXT NOT NULL,
        brief TEXT NOT NULL,
        next_steps TEXT NOT NULL,
        key_points JSONB,
        attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
        gong_url TEXT NOT NULL,
        synced_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (opportunity_id, conversation_key)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_gong_calls_opportunity_date
      ON gong_calls(opportunity_id, call_date DESC)
    `);

    await client.query(`
      ALTER TABLE gong_calls
      ADD COLUMN IF NOT EXISTS attendees JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    // Per-opportunity TTL metadata. Empty results are also marked synced so
    // opportunities without calls are not queried on every detail open.
    await client.query(`
      CREATE TABLE IF NOT EXISTS gong_sync_meta (
        opportunity_id VARCHAR(255) PRIMARY KEY,
        last_synced_at TIMESTAMP NOT NULL,
        cache_version INTEGER NOT NULL DEFAULT 3
      )
    `);

    await client.query(`
      ALTER TABLE gong_sync_meta
      ADD COLUMN IF NOT EXISTS cache_version INTEGER NOT NULL DEFAULT 1
    `);

    await client.query("COMMIT");

    console.log("✅ Database tables initialized successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Database initialization failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check query
 */
export async function checkDatabaseHealth() {
  try {
    const result = await pool.query("SELECT NOW() as current_time");
    return {
      status: "connected",
      timestamp: result.rows[0].current_time,
    };
  } catch (error) {
    return {
      status: "disconnected",
      error: error.message,
    };
  }
}

/**
 * Aggregate counts from the local PostgreSQL mirror tables:
 *   - opportunities: distinct opportunity ids across all users' cached syncs
 *     (opportunities_data is a JSONB array of { id, ... })
 *   - dScores: unique dispassionate_reviews rows (one per review record)
 *   - activities: unique activities rows (one per activity id)
 *   - gongCalls: unique gong_calls rows (one per opportunity/call pair)
 *   - summaries: opportunity_summaries rows (one per opportunity, id is UNIQUE)
 */
export async function getPostgresStats() {
  const [
    oppsResult,
    dScoresResult,
    activitiesResult,
    gongCallsResult,
    summariesResult,
  ] = await Promise.all([
      pool.query(`
      SELECT COUNT(DISTINCT elem->>'id') AS count
      FROM sc_opportunities_cache,
           jsonb_array_elements(opportunities_data) AS elem
    `),
      pool.query("SELECT COUNT(*) AS count FROM dispassionate_reviews"),
      pool.query("SELECT COUNT(*) AS count FROM activities"),
      pool.query(
        "SELECT COUNT(DISTINCT (opportunity_id, conversation_key)) AS count FROM gong_calls",
      ),
      pool.query("SELECT COUNT(*) AS count FROM opportunity_summaries"),
    ]);

  return {
    totalOpportunities: Number(oppsResult.rows[0]?.count ?? 0),
    totalDScores: Number(dScoresResult.rows[0]?.count ?? 0),
    totalActivities: Number(activitiesResult.rows[0]?.count ?? 0),
    totalGongCalls: Number(gongCallsResult.rows[0]?.count ?? 0),
    totalSummaries: Number(summariesResult.rows[0]?.count ?? 0),
  };
}
