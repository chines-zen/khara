import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

// Snowflake imports
import { connectToSnowflake, executeQuery, isSnowflakeConnected, getSnowflakeLastError } from './snowflake-connection.js';
import {
  buildOpportunitiesQuery,
  buildOwnersQuery,
  buildCloseMonthsQuery,
  buildStatsQuery,
  buildScOpportunitiesQuery,
  buildSnowflakeFreshnessQuery,
} from './snowflake-queries.js';

// Database and auth
import { initializeDatabase, checkDatabaseHealth, pool } from './db/index.js';
import { authenticateWithPomerium } from './middleware/auth.js';
import { createSessionMiddleware } from './middleware/session.js';

// Services
import { getCachedSummary, getSummaryIfCached, cleanupExpiredSummaries } from './services/summary-cache.js';
import { getHiddenOpportunities, hideOpportunity, unhideOpportunity } from './services/hidden-opportunities.js';
import { getScOpportunities, invalidateScCache, cleanupExpiredScCache, getLastScCacheSync } from './services/sc-opportunities-cache.js';
import { getActivities, invalidateActivitiesCache } from './services/activities-cache.js';
import { getDispassionateReviewsForOpportunity } from './services/dispassionate-reviews-cache.js';
import { resolveScUserId } from './services/sc-lookup.js';
import { getEffectiveOppScope } from './services/opp-scope.js';

// Routes
import preferencesRouter from './routes/preferences.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// ============================================================================
// INITIALIZATION
// ============================================================================

let databaseConnected = false;

const SNOWFLAKE_RETRY_INTERVAL_MS = 30_000;

// Initialize database on startup
initializeDatabase()
  .then(() => {
    databaseConnected = true;
    console.log('✅ Database initialized');

    // Clean up expired summaries on startup
    return cleanupExpiredSummaries()
      .then(() => cleanupExpiredScCache());
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database:', err.message);
    console.error('   The app will run but database features will fail.');
  });

// Connect to Snowflake on startup, retrying on failure so a missed SSO
// prompt or transient error doesn't permanently disable it for the process lifetime.
// Only applies to the shared service-account connection — in EXTERNALBROWSER mode
// there's no identity to connect as until a user's email is known, so connections
// are established lazily per-request instead (see snowflake-connection.js).
function connectToSnowflakeWithRetry() {
  connectToSnowflake()
    .then(() => {
      console.log('✅ Snowflake connection established');
    })
    .catch((err) => {
      console.error('❌ Failed to connect to Snowflake:', err.message);
      console.error(`   Retrying in ${SNOWFLAKE_RETRY_INTERVAL_MS / 1000}s. API calls will fail until connected.`);
      setTimeout(connectToSnowflakeWithRetry, SNOWFLAKE_RETRY_INTERVAL_MS);
    });
}

const SNOWFLAKE_SERVICE_ACCOUNT_MODE = Boolean(process.env.SNOWFLAKE_USERNAME && process.env.SNOWFLAKE_PASSWORD);

if (SNOWFLAKE_SERVICE_ACCOUNT_MODE) {
  connectToSnowflakeWithRetry();
}

// ============================================================================
// MIDDLEWARE (ORDER MATTERS!)
// ============================================================================

// 1. CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true, // Allow cookies for session
}));

// 2. Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Cookie parsing (required for sessions)
app.use(cookieParser());

// 4. Session management (PostgreSQL store)
app.use(createSessionMiddleware());

// 5. Request logging (all requests)
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`);
  next();
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse most recent date from SC Notes field
 * Looks for dates in formats like: 5/26/26, 5.26.26, 5-26-26, 05/26/2026, etc.
 */
function parseMostRecentDateFromNotes(notes) {
  if (!notes) return null;

  // Match various date formats: M/D/YY, M.D.YY, M-D-YY, MM/DD/YYYY, etc.
  const datePattern = /\b(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})\b/g;
  const matches = [...notes.matchAll(datePattern)];

  if (matches.length === 0) return null;

  // Parse all dates and find the most recent
  const dates = matches.map(match => {
    let [_, month, day, year] = match;

    // Convert 2-digit year to 4-digit (26 -> 2026)
    if (year.length === 2) {
      year = '20' + year;
    }

    // Create date object (month is 0-indexed in JS)
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }).filter(d => !isNaN(d.getTime())); // Filter out invalid dates

  if (dates.length === 0) return null;

  // Return most recent date in YYYY-MM-DD format
  const mostRecent = new Date(Math.max(...dates));
  return mostRecent.toISOString().split('T')[0];
}

/**
 * Transform Snowflake row to match frontend format
 */
function normalizeStage(stage) {
  if (stage === '08 - Closed') return 'Won';
  return stage;
}

function transformOpportunity(row) {
  return {
    id: row.ID,
    name: row.NAME,
    account: row.ACCOUNT || 'Unknown Account',
    stage: normalizeStage(row.STAGE) || 'Unknown',
    type: row.TYPE,
    territory: row.TERRITORY,
    amount: row.AMOUNT || 0,
    closeDate: row.CLOSE_DATE ? row.CLOSE_DATE.toISOString().split('T')[0] : null,
    createdDate: row.CREATED_DATE ? row.CREATED_DATE.toISOString().split('T')[0] : null,
    owner: row.OWNER || 'Not Available',
    scNotes: row.SC_NOTES || '',
    nextSteps: row.NEXT_STEPS || '',
    managerNotes: row.MANAGER_NOTES || '',
    scManagerNotes: row.SC_MANAGER_NOTES || '',
    scEngagementType: row.SC_ENGAGEMENT_TYPE || '',
    productSpecialistNotes: row.PRODUCT_SPECIALIST_NOTES || '',
    nameOfSc: row.NAME_OF_SC || 'Not Assigned',
    scUserId: row.SC_USER_ID,
    dScore: row.D_SCORE || 0,
    lastUpdateDate: parseMostRecentDateFromNotes(row.SC_NOTES), // Parse from SC Notes for "Days Since Update"
    latestDScoreReviewDate: row.LATEST_DSCORE_REVIEW_DATE
      ? row.LATEST_DSCORE_REVIEW_DATE.toISOString().split('T')[0]
      : null,
    dScoreDelta: 0, // TODO: Calculate from historical snapshots
    opportunityNumber: row.OPPORTUNITY_NUMBER,
    snapshotDate: row.SNAPSHOT_DATE ? row.SNAPSHOT_DATE.toISOString().split('T')[0] : null,
  };
}

// ============================================================================
// PUBLIC API ENDPOINTS (no auth required)
// ============================================================================

// Health check - includes both Snowflake and PostgreSQL status
app.get('/api/health', async (req, res) => {
  const dbHealth = await checkDatabaseHealth();
  const snowflakeConnected = isSnowflakeConnected();

  // Server-side freshness (when Snowflake's source data was last refreshed) is
  // only queryable over an already-established connection - EXTERNALBROWSER mode
  // has no shared connection until a user logs in, so this stays null there.
  let serverUpdatedAt = null;
  if (snowflakeConnected) {
    try {
      const rows = await executeQuery(buildSnowflakeFreshnessQuery());
      const lastRunDate = rows[0]?.LAST_RUN_DATE;
      serverUpdatedAt = lastRunDate ? lastRunDate.toISOString().split('T')[0] : null;
    } catch (error) {
      console.error('Error fetching Snowflake freshness:', error);
    }
  }

  const appUpdatedAt = await getLastScCacheSync().catch((error) => {
    console.error('Error fetching last SC cache sync:', error);
    return null;
  });

  res.json({
    snowflake: {
      status: snowflakeConnected ? 'connected' : 'disconnected',
      database: 'Snowflake',
      lastError: snowflakeConnected ? null : getSnowflakeLastError(),
      serverUpdatedAt,
    },
    postgresql: dbHealth,
    appUpdatedAt,
    devMode: process.env.DEV_MODE === 'true',
    activitiesEnabled: process.env.ACTIVITIES_ENABLED === 'true',
    doNotClickActive: process.env.DO_NOT_CLICK_ACTIVE === 'true',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

/**
 * GET /api/me
 * Get current user info from session
 * Protected by Pomerium (must have valid headers)
 */
app.get('/api/me', authenticateWithPomerium, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    createdAt: req.user.created_at,
    lastLogin: req.user.last_login,
    needsEmailSetup: Boolean(req.user.needsEmailSetup),
    isManager: Boolean(req.user.is_manager),
  });
});

/**
 * POST /api/auth/logout
 * Clear session (does not log out of Pomerium SSO)
 */
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true, message: 'Session cleared' });
  });
});

// DEV_MODE only: let a developer switch which email authenticateWithPomerium's
// bypass uses, so SC-scoped filtering can be exercised without real Pomerium headers.
if (process.env.DEV_MODE === 'true') {
  app.post('/api/dev/session-email', async (req, res) => {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Missing "email" in request body' });
    }

    // In EXTERNALBROWSER mode this pops a browser SSO login for the given email;
    // fail here (rather than on the next opportunities fetch) so a cancelled or
    // failed SSO attempt surfaces immediately in the capture dialog.
    try {
      await connectToSnowflake(email);
    } catch (error) {
      console.error('Failed to connect to Snowflake for dev session email:', error);
      return res.status(502).json({
        error: 'Failed to authenticate with Snowflake',
        details: error.message,
      });
    }

    req.session.devEmailOverride = email;
    req.session.save((err) => {
      if (err) {
        console.error('Failed to save dev session email:', err);
        return res.status(500).json({ error: 'Failed to save dev session email' });
      }
      res.json({ success: true, email });
    });
  });
}

// ============================================================================
// PROTECTED API ENDPOINTS (require Pomerium auth)
// ============================================================================

// User preferences routes
app.use('/api/user-preferences', authenticateWithPomerium, preferencesRouter);

// POST /api/opportunities - Get filtered opportunities, scoped to the logged-in SC
app.post('/api/opportunities', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const scEmail = req.user.email;
    const scUser = await resolveScUserId(scEmail);

    if (!scUser) {
      return res.status(404).json({
        error: 'SC user not found',
        details: `No Snowflake user record found for email: ${scEmail}. You may not be registered as an SC in Salesforce.`,
      });
    }

    const scope = await getEffectiveOppScope(req.user.id);
    const filters = req.body;

    const filtersWithScope = {
      ...filters,
      scUserId: scUser.userId,
      closeDateFrom: scope.closeDateFrom,
      closeDateTo: scope.closeDateTo,
      arrMin: filters.arrMin ?? scope.arrThreshold,
    };

    const sql = buildOpportunitiesQuery(filtersWithScope);
    console.log('Executing query...');

    const rows = await executeQuery(sql, undefined, scEmail);
    console.log(`Found ${rows.length} opportunities`);

    const opportunities = rows.map(transformOpportunity);
    res.json(opportunities);
  } catch (error) {
    console.error('Error fetching opportunities:', error);
    res.status(500).json({ error: 'Failed to fetch opportunities', details: error.message });
  }
});

// GET /api/opportunities/my-sc-opps - Get opportunities where user is SC (scoped by stage + ARR/close-date, 12hr cache)
app.get('/api/opportunities/my-sc-opps', authenticateWithPomerium, async (req, res) => {
  console.log('📥 GET /api/opportunities/my-sc-opps - Request received');
  try {
    if (!databaseConnected) {
      console.log('❌ Database not connected');
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const userId = req.user.id;
    const scEmail = req.user.email;
    console.log(`👤 User: ${userId} (SC: ${scEmail})`);

    const scope = await getEffectiveOppScope(userId);
    // Sales Engineers scoping is manager-only — strip it for anyone else even
    // if a stale preference value has it set (e.g. is_manager was revoked).
    if (!req.user.is_manager) {
      scope.scEmails = [];
    }

    // Managers rarely own opportunities under their own name, so a sync scoped
    // to their own SC identity would be empty/meaningless. Require them to
    // configure the SEs they manage before the first data fetch runs.
    if (req.user.is_manager && scope.scEmails.length === 0) {
      return res.status(428).json({
        error: 'SE emails required',
        code: 'SE_EMAILS_REQUIRED',
        details: 'Add the Sales Engineers you manage in Settings before your first data sync.',
      });
    }

    // Get opportunities (with caching)
    const result = await getScOpportunities(userId, scEmail, scope);

    res.json({
      opportunities: result.opportunities,
      metadata: {
        cached: result.cached,
        cachedAt: result.cachedAt,
        expiresAt: result.expiresAt,
        count: result.opportunities.length,
      },
    });
  } catch (error) {
    console.error('Error fetching SC opportunities:', error);

    // Special handling for "no Snowflake user found" case
    if (error.message.includes('No Snowflake user found')) {
      return res.status(404).json({
        error: 'SC user not found',
        details: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to fetch SC opportunities',
      details: error.message,
    });
  }
});

// DELETE /api/opportunities/my-sc-opps/cache - Force refresh cache
app.delete('/api/opportunities/my-sc-opps/cache', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    await invalidateScCache(req.user.id);
    res.json({ success: true, message: 'SC opportunities cache cleared' });
  } catch (error) {
    console.error('Error clearing SC cache:', error);
    res.status(500).json({ error: 'Failed to clear cache', details: error.message });
  }
});

// GET /api/activities - Get activities for the current SE (or their team, if
// a manager with SE scoping configured), scoped to the current fiscal year
app.get('/api/activities', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const scope = await getEffectiveOppScope(req.user.id);
    // Sales Engineers scoping is manager-only - strip it for anyone else even
    // if a stale preference value has it set (e.g. is_manager was revoked).
    const scEmails = req.user.is_manager ? scope.scEmails : [];

    const result = await getActivities(req.user.email, { scEmails });

    res.json({
      activities: result.activities,
      metadata: {
        cached: result.cached,
        cachedAt: result.cachedAt,
        count: result.activities.length,
      },
    });
  } catch (error) {
    console.error('Error fetching activities:', error);

    if (error.message.includes('No Snowflake user found')) {
      return res.status(404).json({
        error: 'SE user not found',
        details: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to fetch activities',
      details: error.message,
    });
  }
});

// DELETE /api/activities/cache - Force refresh activities cache
app.delete('/api/activities/cache', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    await invalidateActivitiesCache();
    res.json({ success: true, message: 'Activities cache cleared' });
  } catch (error) {
    console.error('Error clearing activities cache:', error);
    res.status(500).json({ error: 'Failed to clear cache', details: error.message });
  }
});

// GET /api/opportunities/:id/summary/cached - Look up a cached summary without
// generating one on a miss. Used to populate the UI when an opportunity is
// opened, so switching between opps never triggers an AI call.
app.get('/api/opportunities/:id/summary/cached', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const result = await getSummaryIfCached(req.params.id);
    res.json(result); // null if no summary has been generated yet
  } catch (error) {
    console.error('Error fetching cached summary:', error);
    res.status(500).json({ error: 'Failed to fetch cached summary', details: error.message });
  }
});

// GET /api/opportunities/:id/dispassionate-reviews - D-Score review history for
// one opp, syncing from Snowflake on a cache miss (24h per-opp TTL).
app.get('/api/opportunities/:id/dispassionate-reviews', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const result = await getDispassionateReviewsForOpportunity(req.params.id, req.user.email);
    res.json({
      reviews: result.reviews,
      metadata: {
        cached: result.cached,
        cachedAt: result.cachedAt,
        count: result.reviews.length,
      },
    });
  } catch (error) {
    console.error('Error fetching dispassionate reviews:', error);
    res.status(500).json({ error: 'Failed to fetch dispassionate reviews', details: error.message });
  }
});

// GET /api/opportunities/:id/summary - Generate or retrieve cached AI summary
// Query param: ?regenerate=true to force regenerate
app.get('/api/opportunities/:id/summary', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const { id } = req.params;
    const forceRegenerate = req.query.regenerate === 'true';

    // Fetch opportunity data from Snowflake
    const sql = buildOpportunitiesQuery({
      opportunityIds: [id]
    });

    const rows = await executeQuery(sql, undefined, req.user.email);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const oppData = transformOpportunity(rows[0]);

    // Get cached summary or generate new one (force regenerate if requested)
    const result = await getCachedSummary(id, {
      opportunityName: oppData.name,
      account: oppData.account,
      stage: oppData.stage,
      amount: oppData.amount,
      closeDate: oppData.closeDate,
      owner: oppData.owner,
      scNotes: oppData.scNotes || 'No SC notes',
      nextSteps: oppData.nextSteps || 'No next steps documented',
      managerNotes: oppData.managerNotes || 'No manager notes',
      scManagerNotes: oppData.scManagerNotes || 'No SC manager notes',
      productSpecialistNotes: oppData.productSpecialistNotes || 'No product specialist notes',
      dScore: oppData.dScore,
    }, forceRegenerate);

    res.json(result);
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({
      error: 'Failed to generate summary',
      details: error.message
    });
  }
});

// GET /api/owners - Get unique owners
app.get('/api/owners', authenticateWithPomerium, async (req, res) => {
  try {
    const sql = buildOwnersQuery();
    const rows = await executeQuery(sql, undefined, req.user.email);

    const owners = rows.map(row => row.OWNER).filter(Boolean);
    res.json(owners);
  } catch (error) {
    console.error('Error fetching owners:', error);
    res.status(500).json({ error: 'Failed to fetch owners', details: error.message });
  }
});

// GET /api/close-months - Get available close months
app.get('/api/close-months', authenticateWithPomerium, async (req, res) => {
  try {
    const sql = buildCloseMonthsQuery();
    const rows = await executeQuery(sql, undefined, req.user.email);

    const months = rows.map(row => row.CLOSE_MONTH).filter(Boolean);
    res.json(months);
  } catch (error) {
    console.error('Error fetching close months:', error);
    res.status(500).json({ error: 'Failed to fetch close months', details: error.message });
  }
});

// GET /api/stats - Get aggregate stats
app.get('/api/stats', authenticateWithPomerium, async (req, res) => {
  try {
    const sql = buildStatsQuery();
    const rows = await executeQuery(sql, undefined, req.user.email);

    const stats = rows[0] || {};
    res.json({
      totalOpportunities: stats.TOTAL_OPPORTUNITIES || 0,
      totalStages: stats.TOTAL_STAGES || 0,
      totalOwners: stats.TOTAL_OWNERS || 0,
      totalPipelineValue: stats.TOTAL_PIPELINE_VALUE || 0,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
});

// GET /api/hidden-opportunities - Get all hidden opportunity IDs for the current user
app.get('/api/hidden-opportunities', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const hiddenIds = await getHiddenOpportunities(req.user.id);
    res.json({ hiddenOpportunityIds: hiddenIds });
  } catch (error) {
    console.error('Error fetching hidden opportunities:', error);
    res.status(500).json({ error: 'Failed to fetch hidden opportunities', details: error.message });
  }
});

// POST /api/hidden-opportunities/:id - Hide an opportunity
app.post('/api/hidden-opportunities/:id', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const opportunityId = req.params.id;
    await hideOpportunity(req.user.id, opportunityId);
    res.json({ success: true, message: 'Opportunity hidden' });
  } catch (error) {
    console.error('Error hiding opportunity:', error);
    res.status(500).json({ error: 'Failed to hide opportunity', details: error.message });
  }
});

// DELETE /api/hidden-opportunities/:id - Unhide an opportunity
app.delete('/api/hidden-opportunities/:id', authenticateWithPomerium, async (req, res) => {
  try {
    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const opportunityId = req.params.id;
    await unhideOpportunity(req.user.id, opportunityId);
    res.json({ success: true, message: 'Opportunity unhidden' });
  } catch (error) {
    console.error('Error unhiding opportunity:', error);
    res.status(500).json({ error: 'Failed to unhide opportunity', details: error.message });
  }
});

// ============================================================================
// SERVE FRONTEND
// ============================================================================

// Serve static files
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`\n🚀 SE Opp Rigor server running on http://localhost:${PORT}`);
  console.log(`📊 API endpoints:`);
  console.log(`   GET  http://localhost:${PORT}/api/health (public)`);
  console.log(`   GET  http://localhost:${PORT}/api/me (protected)`);
  console.log(`   POST http://localhost:${PORT}/api/auth/logout (protected)`);
  console.log(`   POST http://localhost:${PORT}/api/opportunities (protected)`);
  console.log(`   GET  http://localhost:${PORT}/api/opportunities/:id/summary (protected)`);
  console.log(`   GET  http://localhost:${PORT}/api/owners (protected)`);
  console.log(`   GET  http://localhost:${PORT}/api/close-months (protected)`);
  console.log(`   GET  http://localhost:${PORT}/api/stats (protected)`);
  console.log(`   GET  http://localhost:${PORT}/api/user-preferences (protected)`);
  console.log(`   PUT  http://localhost:${PORT}/api/user-preferences/:key (protected)`);
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  await pool.end();
  process.exit(0);
});
