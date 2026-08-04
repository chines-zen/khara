import { pool } from '../db/index.js';
import { executeQuery } from '../snowflake-connection.js';
import {
  buildScOpportunityBaseTargetQuery,
  buildScOpportunityTargetAmountsQuery,
  buildScOpportunitiesTargetedQuery,
} from '../snowflake-queries.js';
import { resolveScUserId, resolveScUserIds } from './sc-lookup.js';

const CACHE_TTL_HOURS = 12;

/**
 * Get opportunities for SC user (with 12-hour cache)
 * @param {number} userId - PostgreSQL user ID
 * @param {string} userEmail - Email for Snowflake lookup
 * @param {{ arrThreshold?: number, closeDateFrom?: string, closeDateTo?: string, scEmails?: string[], scUserIds?: string[], sfdcUserId?: string, force?: boolean }} [scope]
 *   scEmails (manager-only): when set, opportunities are scoped to these SCs
 *   instead of userEmail's own identity.
 *   scUserIds (manager-only): USER_IDs already resolved for scEmails, so the
 *   refresh path doesn't re-query USER_HISTORY. Partial/absent entries are
 *   resolved on demand.
 *   sfdcUserId: the requesting user's own cached USER_ID (users.sfdc_user_id),
 *   used when scEmails is empty. Avoids an identity query per cache refresh.
 *   force: bypass the 12-hour cache and materialize a new scoped snapshot.
 */
export async function getScOpportunities(userId, userEmail, scope = {}) {
  console.log(`[SC Cache] Checking cache for user ${userId} (${userEmail})`);

  // Check cache first, unless a unified/manual sync explicitly asks us to
  // materialize a fresh scoped opportunity set from Snowflake.
  const cached = scope.force ? null : await getCachedScOpportunities(userId);
  if (cached) {
    console.log(`[SC Cache] HIT - returning ${cached.opportunities_data.length} cached opportunities`);
    return {
      opportunities: cached.opportunities_data,
      cached: true,
      cachedAt: cached.cached_at,
      expiresAt: cached.expires_at,
    };
  }

  // Cache miss - query Snowflake
  console.log(`[SC Cache] MISS - querying Snowflake for user ${userId}`);
  const { snowflakeUserId, opportunities } = await fetchScOpportunitiesFromSnowflake(userEmail, scope);
  console.log(`[SC Cache] Returned ${opportunities.length} opportunities for SC`);

  // Store in cache
  await cacheScOpportunities(userId, snowflakeUserId, opportunities, scope);

  return {
    opportunities,
    cached: false,
    cachedAt: new Date(),
    expiresAt: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000),
  };
}

async function getCachedScOpportunities(userId) {
  const query = `
    SELECT snowflake_user_id, opportunities_data, cached_at, expires_at
    FROM sc_opportunities_cache
    WHERE user_id = $1
      AND expires_at > NOW()
  `;

  const result = await pool.query(query, [userId]);

  if (result.rows.length > 0) {
    console.log(`SC opportunities cache HIT for user ${userId}`);
  }

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Whether the requesting user's scoped opportunity snapshot can be served
 * without a Snowflake pull. The opportunities route uses this to decide
 * whether an ordinary page load may read its cache or must start the unified
 * four-domain sync first.
 */
export async function hasFreshScOpportunitiesCache(userId) {
  return Boolean(await getCachedScOpportunities(userId));
}

async function fetchScOpportunitiesFromSnowflake(userEmail, scope = {}) {
  const { scEmails = [], scUserIds = [], sfdcUserId = null } = scope;

  // Step 1: Resolve Snowflake USER_ID(s). Manager scoping (scEmails set) resolves
  // those SCs' identities instead of the logged-in user's own. Both branches
  // prefer an already-cached USER_ID so a cache refresh is a single Snowflake
  // query (the opportunity query) rather than an identity lookup plus that.
  let snowflakeUserIds;
  if (scEmails.length > 0) {
    snowflakeUserIds = scUserIds.length > 0
      ? scUserIds
      : await resolveScUserIds(scEmails, userEmail);

    if (snowflakeUserIds.length === 0) {
      throw new Error(`No Snowflake user found for any of: ${scEmails.join(', ')}`);
    }
  } else if (sfdcUserId) {
    snowflakeUserIds = [sfdcUserId];
  } else {
    const scUser = await resolveScUserId(userEmail);

    if (!scUser) {
      throw new Error(`No Snowflake user found for email: ${userEmail}`);
    }

    snowflakeUserIds = [scUser.userId];
  }

  // Step 2: Resolve the small, scoped target set before joining the expensive
  // enrichment sources. The previous one-shot query scanned/enriched the broad
  // source set and applied this scope only at the end. In side-by-side manager
  // testing this three-step version returned the same opportunity rows 57.8%
  // faster (43.3s -> 18.3s).
  const baseRows = await executeQuery(
    buildScOpportunityBaseTargetQuery(snowflakeUserIds, scope),
    undefined,
    userEmail,
  );
  const baseTargets = new Map();
  for (const row of baseRows) {
    if (row.OPPORTUNITY_ID) {
      baseTargets.set(row.OPPORTUNITY_ID, row.SC_USER_ID ?? null);
    }
  }

  if (baseTargets.size === 0) {
    return { snowflakeUserId: snowflakeUserIds.join(','), opportunities: [] };
  }

  const amountRows = await executeQuery(
    buildScOpportunityTargetAmountsQuery([...baseTargets.keys()]),
    undefined,
    userEmail,
  );
  const amountsByOpportunityId = new Map(
    amountRows.map((row) => [row.OPPORTUNITY_ID, row.AMOUNT]),
  );

  const hasArrThreshold =
    scope.arrThreshold !== null &&
    scope.arrThreshold !== undefined &&
    !Number.isNaN(Number(scope.arrThreshold));
  const targets = [...baseTargets.entries()]
    .map(([id, scUserId]) => ({
      id,
      scUserId,
      amount: amountsByOpportunityId.get(id) ?? null,
    }))
    // The legacy query's `arr.product_arr_usd >= ...` condition is on a LEFT
    // JOINed table, which deliberately excludes opportunities without a latest
    // booking row when an ARR threshold is in effect. Preserve that behavior.
    .filter(
      (target) =>
        !hasArrThreshold || Number(target.amount) >= Number(scope.arrThreshold),
    );

  if (targets.length === 0) {
    return { snowflakeUserId: snowflakeUserIds.join(','), opportunities: [] };
  }

  const oppRows = await executeQuery(
    buildScOpportunitiesTargetedQuery(targets),
    undefined,
    userEmail,
  );

  // Step 3: Transform to frontend format
  const opportunities = oppRows.map(transformOpportunity);

  return { snowflakeUserId: snowflakeUserIds.join(','), opportunities };
}

async function cacheScOpportunities(userId, snowflakeUserId, opportunities, scope = {}) {
  const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000);

  // Persist only the scope fields worth reporting on the admin page, not the
  // full scope object (which may carry incidental request fields).
  const scopeToStore = {
    arrThreshold: scope.arrThreshold ?? null,
    closeDatePreset: scope.closeDatePreset ?? null,
    closeDateFrom: scope.closeDateFrom ?? null,
    closeDateTo: scope.closeDateTo ?? null,
    scEmails: Array.isArray(scope.scEmails) ? scope.scEmails : [],
  };

  const query = `
    INSERT INTO sc_opportunities_cache (user_id, snowflake_user_id, opportunities_data, scope, cached_at, expires_at)
    VALUES ($1, $2, $3, $4, NOW(), $5)
    ON CONFLICT (user_id)
    DO UPDATE SET
      snowflake_user_id = EXCLUDED.snowflake_user_id,
      opportunities_data = EXCLUDED.opportunities_data,
      scope = EXCLUDED.scope,
      cached_at = EXCLUDED.cached_at,
      expires_at = EXCLUDED.expires_at
  `;

  await pool.query(query, [userId, snowflakeUserId, JSON.stringify(opportunities), JSON.stringify(scopeToStore), expiresAt]);
}

/**
 * Most recent cache write across all users - i.e. when the app last synced
 * opportunity data from Snowflake - along with the scope that sync covered.
 * @returns {Promise<{ lastCachedAt: Date | null, scope: object | null }>}
 */
export async function getLastScCacheSync() {
  // Two separate lookups so a single legacy/partial row (scope written NULL by an
  // older app version) can't blank out the admin card: report the newest sync
  // timestamp regardless, but pull scope from the newest row that actually has one.
  const [latest, latestWithScope] = await Promise.all([
    pool.query(
      `SELECT cached_at
       FROM sc_opportunities_cache
       ORDER BY cached_at DESC NULLS LAST
       LIMIT 1`
    ),
    pool.query(
      `SELECT scope
       FROM sc_opportunities_cache
       WHERE scope IS NOT NULL
       ORDER BY cached_at DESC NULLS LAST
       LIMIT 1`
    ),
  ]);

  return {
    lastCachedAt: latest.rows[0]?.cached_at ?? null,
    scope: latestWithScope.rows[0]?.scope ?? null,
  };
}

/**
 * Invalidate cache for a specific user
 */
export async function invalidateScCache(userId) {
  await pool.query('DELETE FROM sc_opportunities_cache WHERE user_id = $1', [userId]);
}

/**
 * Clean up expired cache entries (run on startup)
 */
export async function cleanupExpiredScCache() {
  const result = await pool.query('DELETE FROM sc_opportunities_cache WHERE expires_at < NOW()');
  console.log(`✅ Cleaned up ${result.rowCount} expired SC opportunity caches`);
}

/**
 * Transform Snowflake row to match frontend format
 * (Reused from index.js)
 */
function normalizeStage(stage) {
  if (stage === '08 - Closed') return 'Won';
  return stage;
}

export function transformOpportunity(row) {
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
    lastUpdateDate: parseMostRecentDateFromNotes(row.SC_NOTES),
    latestDScoreReviewDate: row.LATEST_DSCORE_REVIEW_DATE
      ? row.LATEST_DSCORE_REVIEW_DATE.toISOString().split('T')[0]
      : null,
    dScoreDelta: 0,
    opportunityNumber: row.OPPORTUNITY_NUMBER,
    snapshotDate: row.SNAPSHOT_DATE ? row.SNAPSHOT_DATE.toISOString().split('T')[0] : null,
  };
}

/**
 * Parse most recent date from SC Notes field
 * (Reused from index.js)
 */
function parseMostRecentDateFromNotes(notes) {
  if (!notes) return null;

  const datePattern = /\b(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})\b/g;
  const matches = [...notes.matchAll(datePattern)];

  if (matches.length === 0) return null;

  const dates = matches.map(match => {
    let [_, month, day, year] = match;

    if (year.length === 2) {
      year = '20' + year;
    }

    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }).filter(d => !isNaN(d.getTime()));

  if (dates.length === 0) return null;

  const mostRecent = new Date(Math.max(...dates));
  return mostRecent.toISOString().split('T')[0];
}
