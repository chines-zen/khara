import pg from 'pg';
const { Pool } = pg;

// PostgreSQL connection pool
export const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('✅ PostgreSQL pool connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err);
});

/**
 * Initialize database tables on startup
 * Creates tables if they don't exist (idempotent)
 */
export async function initializeDatabase() {
  const client = await pool.connect();

  try {
    console.log('📦 Initializing database tables...');

    await client.query('BEGIN');

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

    // Indexes for cache lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sc_cache_user_id ON sc_opportunities_cache(user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sc_cache_expires ON sc_opportunities_cache(expires_at)
    `);

    await client.query('COMMIT');

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Database initialization failed:', error);
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
    const result = await pool.query('SELECT NOW() as current_time');
    return {
      status: 'connected',
      timestamp: result.rows[0].current_time,
    };
  } catch (error) {
    return {
      status: 'disconnected',
      error: error.message,
    };
  }
}
