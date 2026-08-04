import { pool } from "../db/index.js";
import { executeQuery } from "../snowflake-connection.js";
import { buildOpportunitiesQuery } from "../snowflake-queries.js";
import { transformOpportunity } from "./sc-opportunities-cache.js";

const CACHE_TTL_HOURS = 12;

/**
 * Get the current user's Blind Spots snapshot, refreshing it on a cache miss
 * or when force=true. Blind Spots have their own cache because their scope is
 * independent of the main SC opportunity scope.
 */
export async function getBlindSpots(userId, userEmail, scope = {}) {
  const ownerEmails = Array.isArray(scope.ownerEmails)
    ? scope.ownerEmails
    : [];

  if (ownerEmails.length === 0) {
    return {
      opportunities: [],
      reviewedOpportunityIds: [],
      configured: false,
      cached: true,
      cachedAt: null,
      expiresAt: null,
    };
  }

  const cached = scope.force ? null : await getCachedBlindSpots(userId, scope);
  if (cached) {
    const reviewedOpportunityIds = await getReviewedBlindSpotIds(userId);
    return {
      opportunities: cached.opportunities_data,
      reviewedOpportunityIds,
      configured: true,
      cached: true,
      cachedAt: cached.cached_at,
      expiresAt: cached.expires_at,
    };
  }

  const sql = buildOpportunitiesQuery({
    ownerEmails,
    requireNoSc: true,
    activePipelineOnly: true,
    arrMin: scope.arrThreshold,
    closeDateFrom: scope.closeDateFrom,
    closeDateTo: scope.closeDateTo,
  });
  const rows = await executeQuery(sql, undefined, userEmail);
  const opportunities = rows.map(transformOpportunity);
  const cachedAt = new Date();
  const expiresAt = new Date(
    cachedAt.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000,
  );

  await cacheBlindSpots(userId, opportunities, scope, cachedAt, expiresAt);
  const reviewedOpportunityIds = await getReviewedBlindSpotIds(userId);

  return {
    opportunities,
    reviewedOpportunityIds,
    configured: true,
    cached: false,
    cachedAt,
    expiresAt,
  };
}

export async function getReviewedBlindSpotIds(userId) {
  const result = await pool.query(
    `SELECT opportunity_id
     FROM blind_spot_reviews
     WHERE user_id = $1`,
    [userId],
  );
  return result.rows.map((row) => row.opportunity_id);
}

export async function setBlindSpotReviewed(userId, opportunityId, reviewed) {
  if (reviewed) {
    await pool.query(
      `INSERT INTO blind_spot_reviews (user_id, opportunity_id, reviewed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, opportunity_id)
       DO UPDATE SET reviewed_at = NOW()`,
      [userId, opportunityId],
    );
    return;
  }

  await pool.query(
    `DELETE FROM blind_spot_reviews
     WHERE user_id = $1 AND opportunity_id = $2`,
    [userId, opportunityId],
  );
}

async function getCachedBlindSpots(userId, scope) {
  const result = await pool.query(
    `SELECT opportunities_data, scope, cached_at, expires_at
     FROM blind_spots_cache
     WHERE user_id = $1 AND expires_at > NOW()`,
    [userId],
  );
  const cached = result.rows[0] ?? null;
  if (!cached || !scopeMatches(cached.scope, scope)) return null;
  return cached;
}

function scopeMatches(cachedScope, scope) {
  if (!cachedScope) return false;
  return JSON.stringify(cachedScope) === JSON.stringify({
    ownerEmails: Array.isArray(scope.ownerEmails) ? scope.ownerEmails : [],
    arrThreshold: scope.arrThreshold ?? null,
    closeDatePreset: scope.closeDatePreset ?? null,
    closeDateFrom: scope.closeDateFrom ?? null,
    closeDateTo: scope.closeDateTo ?? null,
  });
}

async function cacheBlindSpots(userId, opportunities, scope, cachedAt, expiresAt) {
  const storedScope = {
    ownerEmails: Array.isArray(scope.ownerEmails) ? scope.ownerEmails : [],
    arrThreshold: scope.arrThreshold ?? null,
    closeDatePreset: scope.closeDatePreset ?? null,
    closeDateFrom: scope.closeDateFrom ?? null,
    closeDateTo: scope.closeDateTo ?? null,
  };

  await pool.query(
    `INSERT INTO blind_spots_cache
       (user_id, opportunities_data, scope, cached_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       opportunities_data = EXCLUDED.opportunities_data,
       scope = EXCLUDED.scope,
       cached_at = EXCLUDED.cached_at,
       expires_at = EXCLUDED.expires_at`,
    [
      userId,
      JSON.stringify(opportunities),
      JSON.stringify(storedScope),
      cachedAt,
      expiresAt,
    ],
  );
}

export async function invalidateBlindSpotsCache(userId) {
  await pool.query("DELETE FROM blind_spots_cache WHERE user_id = $1", [userId]);
}

export async function cleanupExpiredBlindSpotsCache() {
  const result = await pool.query(
    "DELETE FROM blind_spots_cache WHERE expires_at < NOW()",
  );
  console.log(`✅ Cleaned up ${result.rowCount} expired Blind Spots caches`);
}
