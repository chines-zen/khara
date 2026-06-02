import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

// Snowflake imports
import { connectToSnowflake, executeQuery } from './snowflake-connection.js';
import {
  buildOpportunitiesQuery,
  buildOwnersQuery,
  buildCloseMonthsQuery,
  buildStatsQuery,
  buildScOpportunitiesQuery,
} from './snowflake-queries.js';

// Database and auth
import { initializeDatabase, checkDatabaseHealth, pool } from './db/index.js';
import { authenticateWithPomerium } from './middleware/auth.js';
import { createSessionMiddleware } from './middleware/session.js';

// Services
import { getCachedSummary, cleanupExpiredSummaries } from './services/summary-cache.js';
import { getHiddenOpportunities, hideOpportunity, unhideOpportunity } from './services/hidden-opportunities.js';
import { getScOpportunities, invalidateScCache, cleanupExpiredScCache } from './services/sc-opportunities-cache.js';

// Routes
import preferencesRouter from './routes/preferences.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// ============================================================================
// INITIALIZATION
// ============================================================================

let snowflakeConnected = false;
let databaseConnected = false;

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

// Connect to Snowflake on startup
connectToSnowflake()
  .then(() => {
    snowflakeConnected = true;
    console.log('✅ Snowflake connection established');
  })
  .catch((err) => {
    console.error('❌ Failed to connect to Snowflake:', err.message);
    console.error('   The app will run but API calls will fail.');
  });

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
function transformOpportunity(row) {
  return {
    id: row.ID,
    name: row.NAME,
    account: row.ACCOUNT || 'Unknown Account',
    stage: row.STAGE || 'Unknown',
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

  res.json({
    snowflake: {
      status: snowflakeConnected ? 'connected' : 'disconnected',
      database: 'Snowflake',
    },
    postgresql: dbHealth,
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

// ============================================================================
// PROTECTED API ENDPOINTS (require Pomerium auth)
// ============================================================================

// User preferences routes
app.use('/api/user-preferences', authenticateWithPomerium, preferencesRouter);

// POST /api/opportunities - Get filtered opportunities
app.post('/api/opportunities', authenticateWithPomerium, async (req, res) => {
  try {
    if (!snowflakeConnected) {
      return res.status(503).json({ error: 'Snowflake connection not established' });
    }

    const filters = req.body;

    // For testing: use specific opportunity IDs
    const testOpportunityIds = [
      '006PC00000UhFIfYAL',
      '006PC00000VICiQYA1',
      '0066R00000ugmYLQAY',
      '006PC00000Lz2yTYAR',
      '006PC00000VcAe1YAF',
      '006PC00000ZMrMXYA1',
      '006PC00000W4CEfYAN',
      '006PC00000WBQWDYA5',
      '006PC00000YWPPWYA5',
      '006PC00000W3pzeYAB',
      '006PC00000ICTYYYAX',
      '006PC00000W8JKsYAN',
      '006PC00000XM41yYAD',
      '006PC00000XXrU0YAL',
      '006PC00000V0mcHYAR',
      '006PC00000YpZpmYAF',
      '006PC00000TltOcYAJ',
      '006PC00000VyUcTYAV',
      '006PC00000YqHvdYAF',
      '006PC00000UZS8FYAX',
      '006PC00000Y1pxmYAB',
    ];

    // Add test opportunity IDs to filters
    const filtersWithIds = {
      ...filters,
      opportunityIds: testOpportunityIds,
    };

    const sql = buildOpportunitiesQuery(filtersWithIds);
    console.log('Executing query...');

    const rows = await executeQuery(sql);
    console.log(`Found ${rows.length} opportunities`);

    const opportunities = rows.map(transformOpportunity);
    res.json(opportunities);
  } catch (error) {
    console.error('Error fetching opportunities:', error);
    res.status(500).json({ error: 'Failed to fetch opportunities', details: error.message });
  }
});

// GET /api/opportunities/my-sc-opps - Get opportunities where user is SC (stages 00-07, 12hr cache)
app.get('/api/opportunities/my-sc-opps', authenticateWithPomerium, async (req, res) => {
  console.log('📥 GET /api/opportunities/my-sc-opps - Request received');
  try {
    if (!snowflakeConnected) {
      console.log('❌ Snowflake not connected');
      return res.status(503).json({ error: 'Snowflake connection not established' });
    }

    if (!databaseConnected) {
      console.log('❌ Database not connected');
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const userId = req.user.id;
    const userEmail = req.user.email;
    console.log(`👤 User: ${userId} (${userEmail})`);

    // Get opportunities (with caching)
    const result = await getScOpportunities(userId, userEmail);

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
        details: `No Snowflake user record found for email: ${req.user.email}. You may not be registered as an SC in Salesforce.`,
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

// GET /api/opportunities/:id/summary - Generate or retrieve cached AI summary
// Query param: ?regenerate=true to force regenerate
app.get('/api/opportunities/:id/summary', authenticateWithPomerium, async (req, res) => {
  try {
    if (!snowflakeConnected) {
      return res.status(503).json({ error: 'Snowflake connection not established' });
    }

    if (!databaseConnected) {
      return res.status(503).json({ error: 'Database connection not established' });
    }

    const { id } = req.params;
    const forceRegenerate = req.query.regenerate === 'true';

    // Fetch opportunity data from Snowflake
    const sql = buildOpportunitiesQuery({
      opportunityIds: [id]
    });

    const rows = await executeQuery(sql);

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
    if (!snowflakeConnected) {
      return res.status(503).json({ error: 'Snowflake connection not established' });
    }

    const sql = buildOwnersQuery();
    const rows = await executeQuery(sql);

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
    if (!snowflakeConnected) {
      return res.status(503).json({ error: 'Snowflake connection not established' });
    }

    const sql = buildCloseMonthsQuery();
    const rows = await executeQuery(sql);

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
    if (!snowflakeConnected) {
      return res.status(503).json({ error: 'Snowflake connection not established' });
    }

    const sql = buildStatsQuery();
    const rows = await executeQuery(sql);

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
