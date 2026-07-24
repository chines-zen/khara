import { pool } from '../db/index.js';
import { executeQuery } from '../snowflake-connection.js';
import { buildDispassionateReviewsQuery } from '../snowflake-queries.js';
import { getScOpportunities } from './sc-opportunities-cache.js';

// D-Score reviews are periodic manual review events that change far less often
// than daily activity data, so a longer TTL than the 12h used elsewhere is fine.
const CACHE_TTL_HOURS = 24;

// Days subtracted from an opp's last-sync watermark on an incremental pull, so a
// review created/edited right at the boundary (or a late-landing SCD2 version)
// is never skipped. Overlap is harmless - the upsert is idempotent on review id.
const INCREMENTAL_BUFFER_DAYS = 2;

// Every mirrored column, in insert order (used to build the upsert statement).
const REVIEW_COLUMNS = [
  'id',
  'opportunity_id',
  'name',
  'is_deleted',
  'created_by_id',
  'last_modified_by_id',
  'last_activity_date',
  'discovery_score',
  'solution_fit_score',
  'architecture_score',
  'integration_score',
  'security_score',
  'net_value_score',
  'competitiveness_score',
  'partner_score',
  'it_alignment_score',
  'exec_goals_score',
  'services_score',
  'advanced_demo_score',
  'testing_access_score',
  'discovery_score_notes',
  'solution_fit_score_notes',
  'architecture_score_notes',
  'integration_score_notes',
  'security_score_notes',
  'net_value_score_notes',
  'other_competitors_score_notes',
  'partner_score_notes',
  'it_alignment_score_notes',
  'exec_goals_score_notes',
  'services_score_notes',
  'advanced_demo_score_notes',
  'testing_access_score_notes',
  'valid_from_timestamp',
  'valid_to_timestamp',
  'summed_d_score',
];

// The 13 categorical score-dimension columns whose leading digit is a sub-score
// (the *_score_notes free-text columns are deliberately excluded).
const SCORE_DIMENSION_KEYS = [
  'DISCOVERY_SCORE',
  'SOLUTION_FIT_SCORE',
  'ARCHITECTURE_SCORE',
  'INTEGRATION_SCORE',
  'SECURITY_SCORE',
  'NET_VALUE_SCORE',
  'COMPETITIVENESS_SCORE',
  'PARTNER_SCORE',
  'IT_ALIGNMENT_SCORE',
  'EXEC_GOALS_SCORE',
  'SERVICES_SCORE',
  'ADVANCED_DEMO_SCORE',
  'TESTING_ACCESS_SCORE',
];

/**
 * Sum the leading digit of each categorical score dimension on a Snowflake row.
 * Values look like "2 - 71% to 85%; ..." or "1- Basic discovery ..."; a null or
 * digit-less value contributes 0. Returns null only if every dimension is empty.
 */
function computeSummedDScore(row) {
  let sum = 0;
  let sawAny = false;
  for (const key of SCORE_DIMENSION_KEYS) {
    const value = row[key];
    if (value == null) continue;
    const match = String(value).match(/\d/);
    if (match) {
      sum += Number(match[0]);
      sawAny = true;
    }
  }
  return sawAny ? sum : null;
}

/**
 * Get Dispassionate Review (D-Score) history for the caller's "My SC Opps"
 * scope, with a per-opportunity TTL cache. Reuses getScOpportunities so the set
 * of opps whose D-Score history we pull is exactly the set shown on the my-sc-opps
 * page (same ARR/close-date/stage scope, same manager scEmails handling).
 * @param {number} userId - PostgreSQL user id
 * @param {string} userEmail - identity to run Snowflake queries as
 * @param {{ arrThreshold?: number, closeDateFrom?: string, closeDateTo?: string, scEmails?: string[], force?: boolean }} [scope]
 *   `force` (the NavBar "Refresh Data" button) resyncs every in-scope opp now,
 *   ignoring the TTL gate - incrementally for opps already synced, full for new ones.
 * @returns {Promise<{ reviews: object[], cached: boolean, cachedAt: Date | null }>}
 */
export async function getDispassionateReviews(userId, userEmail, scope = {}) {
  const { opportunities } = await getScOpportunities(userId, userEmail, scope);
  const opportunityIds = opportunities.map((o) => o.id).filter(Boolean);

  if (opportunityIds.length === 0) {
    return { reviews: [], cached: true, cachedAt: null };
  }

  const idsToSync = scope.force ? opportunityIds : await getStaleOpportunityIds(opportunityIds);
  if (idsToSync.length > 0) {
    console.log(`[D-Score Cache] ${scope.force ? 'FORCE' : 'MISS'} - syncing ${idsToSync.length} opp(s) from Snowflake`);
    await syncOpportunitiesFromSnowflake(idsToSync, userEmail);
  } else {
    console.log(`[D-Score Cache] HIT - all ${opportunityIds.length} opp(s) fresh`);
  }

  const reviews = await getCachedReviews(opportunityIds);
  const cachedAt = await getOldestSyncTime(opportunityIds);

  return { reviews, cached: idsToSync.length === 0, cachedAt };
}

/**
 * Get Dispassionate Review history for a single opportunity, syncing from
 * Snowflake if stale. Decoupled from any logged-in user's SC scope so it can be
 * called standalone (e.g. the validation script, or a future opp-detail lookup).
 * @param {string} opportunityId - CRM opportunity id (18-char form)
 * @param {string} userEmail - identity to run the Snowflake query as
 * @returns {Promise<{ reviews: object[], cached: boolean, cachedAt: Date | null }>}
 */
export async function getDispassionateReviewsForOpportunity(opportunityId, userEmail) {
  const staleIds = await getStaleOpportunityIds([opportunityId]);
  if (staleIds.length > 0) {
    console.log(`[D-Score Cache] MISS - syncing opp ${opportunityId} from Snowflake`);
    await syncOpportunitiesFromSnowflake(staleIds, userEmail);
  } else {
    console.log(`[D-Score Cache] HIT - opp ${opportunityId} fresh`);
  }

  const reviews = await getCachedReviews([opportunityId]);
  const cachedAt = await getOldestSyncTime([opportunityId]);

  return { reviews, cached: staleIds.length === 0, cachedAt };
}

async function getStaleOpportunityIds(opportunityIds) {
  const result = await pool.query(
    `SELECT opportunity_id FROM dispassionate_reviews_sync_meta
     WHERE opportunity_id = ANY($1) AND last_synced_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
    [opportunityIds],
  );
  const freshIds = new Set(result.rows.map((r) => r.opportunity_id));
  return opportunityIds.filter((id) => !freshIds.has(id));
}

// Map of opportunity_id -> last_synced_at (Date) for opps we've synced before.
// Absence from the map means "never synced" -> needs a full history pull.
async function getSyncWatermarks(opportunityIds) {
  const result = await pool.query(
    `SELECT opportunity_id, last_synced_at FROM dispassionate_reviews_sync_meta WHERE opportunity_id = ANY($1)`,
    [opportunityIds],
  );
  return new Map(result.rows.map((r) => [r.opportunity_id, r.last_synced_at]));
}

// Watermark (epoch ms) minus the safety buffer, as a YYYY-MM-DD string to
// compare against VALID_FROM_TIMESTAMP.
function bufferedSince(epochMs) {
  const d = new Date(epochMs - INCREMENTAL_BUFFER_DAYS * 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

async function getOldestSyncTime(opportunityIds) {
  const result = await pool.query(
    `SELECT MIN(last_synced_at) AS oldest FROM dispassionate_reviews_sync_meta WHERE opportunity_id = ANY($1)`,
    [opportunityIds],
  );
  return result.rows[0]?.oldest ?? null;
}

async function syncOpportunitiesFromSnowflake(opportunityIds, userEmail) {
  // Split opps by whether we've ever synced them. Newly-scoped opps (no
  // watermark row) get a full history pull; already-known opps only need
  // reviews created/edited since their last sync (minus a safety buffer).
  const watermarks = await getSyncWatermarks(opportunityIds);
  const newIds = opportunityIds.filter((id) => !watermarks.has(id));
  const knownIds = opportunityIds.filter((id) => watermarks.has(id));

  const rows = [];
  if (newIds.length > 0) {
    console.log(`[D-Score Cache] Full pull for ${newIds.length} newly-scoped opp(s)`);
    rows.push(...await executeQuery(buildDispassionateReviewsQuery(newIds), undefined, userEmail));
  }
  if (knownIds.length > 0) {
    const since = bufferedSince(Math.min(...knownIds.map((id) => watermarks.get(id).getTime())));
    console.log(`[D-Score Cache] Incremental pull for ${knownIds.length} opp(s) since ${since}`);
    rows.push(...await executeQuery(buildDispassionateReviewsQuery(knownIds, { since }), undefined, userEmail));
  }

  const placeholders = REVIEW_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = REVIEW_COLUMNS.filter((c) => c !== 'id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(',\n           ');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      await client.query(
        `INSERT INTO dispassionate_reviews (${REVIEW_COLUMNS.join(', ')}, synced_at)
         VALUES (${placeholders}, NOW())
         ON CONFLICT (id) DO UPDATE SET
           ${updateSet},
           synced_at = NOW()`,
        [
          row.ID,
          row.OPPORTUNITY_ID,
          row.NAME,
          row.IS_DELETED,
          row.CREATED_BY_ID,
          row.LAST_MODIFIED_BY_ID,
          row.LAST_ACTIVITY_DATE,
          row.DISCOVERY_SCORE,
          row.SOLUTION_FIT_SCORE,
          row.ARCHITECTURE_SCORE,
          row.INTEGRATION_SCORE,
          row.SECURITY_SCORE,
          row.NET_VALUE_SCORE,
          row.COMPETITIVENESS_SCORE,
          row.PARTNER_SCORE,
          row.IT_ALIGNMENT_SCORE,
          row.EXEC_GOALS_SCORE,
          row.SERVICES_SCORE,
          row.ADVANCED_DEMO_SCORE,
          row.TESTING_ACCESS_SCORE,
          row.DISCOVERY_SCORE_NOTES,
          row.SOLUTION_FIT_SCORE_NOTES,
          row.ARCHITECTURE_SCORE_NOTES,
          row.INTEGRATION_SCORE_NOTES,
          row.SECURITY_SCORE_NOTES,
          row.NET_VALUE_SCORE_NOTES,
          row.OTHER_COMPETITORS_SCORE_NOTES,
          row.PARTNER_SCORE_NOTES,
          row.IT_ALIGNMENT_SCORE_NOTES,
          row.EXEC_GOALS_SCORE_NOTES,
          row.SERVICES_SCORE_NOTES,
          row.ADVANCED_DEMO_SCORE_NOTES,
          row.TESTING_ACCESS_SCORE_NOTES,
          row.VALID_FROM_TIMESTAMP,
          row.VALID_TO_TIMESTAMP,
          computeSummedDScore(row),
        ],
      );
    }

    // Mark every requested opp synced - even those with zero reviews - so we
    // don't re-query an opp that legitimately has no D-Score history every cycle.
    for (const opportunityId of opportunityIds) {
      await client.query(
        `INSERT INTO dispassionate_reviews_sync_meta (opportunity_id, last_synced_at)
         VALUES ($1, NOW())
         ON CONFLICT (opportunity_id) DO UPDATE SET last_synced_at = NOW()`,
        [opportunityId],
      );
    }

    await client.query('COMMIT');
    console.log(`[D-Score Cache] Synced ${rows.length} review(s) for ${opportunityIds.length} opp(s)`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getCachedReviews(opportunityIds) {
  const result = await pool.query(
    `SELECT * FROM dispassionate_reviews
     WHERE opportunity_id = ANY($1)
     ORDER BY opportunity_id, valid_from_timestamp DESC`,
    [opportunityIds],
  );
  return result.rows.map(transformReview);
}

function toDateString(value) {
  return value ? value.toISOString().split('T')[0] : null;
}

function transformReview(row) {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    name: row.name,
    isDeleted: row.is_deleted,
    createdById: row.created_by_id,
    lastModifiedById: row.last_modified_by_id,
    lastActivityDate: toDateString(row.last_activity_date),
    summedDScore: row.summed_d_score !== null ? Number(row.summed_d_score) : null,
    scores: {
      discovery: row.discovery_score,
      solutionFit: row.solution_fit_score,
      architecture: row.architecture_score,
      integration: row.integration_score,
      security: row.security_score,
      netValue: row.net_value_score,
      competitiveness: row.competitiveness_score,
      partner: row.partner_score,
      itAlignment: row.it_alignment_score,
      execGoals: row.exec_goals_score,
      services: row.services_score,
      advancedDemo: row.advanced_demo_score,
      testingAccess: row.testing_access_score,
    },
    notes: {
      discovery: row.discovery_score_notes,
      solutionFit: row.solution_fit_score_notes,
      architecture: row.architecture_score_notes,
      integration: row.integration_score_notes,
      security: row.security_score_notes,
      netValue: row.net_value_score_notes,
      otherCompetitors: row.other_competitors_score_notes,
      partner: row.partner_score_notes,
      itAlignment: row.it_alignment_score_notes,
      execGoals: row.exec_goals_score_notes,
      services: row.services_score_notes,
      advancedDemo: row.advanced_demo_score_notes,
      testingAccess: row.testing_access_score_notes,
    },
    validFromTimestamp: row.valid_from_timestamp ? row.valid_from_timestamp.toISOString() : null,
    validToTimestamp: row.valid_to_timestamp ? row.valid_to_timestamp.toISOString() : null,
    syncedAt: row.synced_at ? row.synced_at.toISOString() : null,
  };
}

/**
 * Most recent sync across all opportunities - i.e. when the app last synced any
 * D-Score review data from Snowflake.
 */
export async function getLastDispassionateReviewsSync() {
  const result = await pool.query('SELECT MAX(last_synced_at) AS last_synced_at FROM dispassionate_reviews_sync_meta');
  return result.rows[0]?.last_synced_at ?? null;
}

/**
 * Force a resync on next request by dropping sync-meta rows for these opps (or
 * all opps if none specified). The mirrored review rows are left in place -
 * they'll be overwritten by the next sync's upsert.
 */
export async function invalidateDispassionateReviewsCache(opportunityIds) {
  if (opportunityIds && opportunityIds.length > 0) {
    await pool.query('DELETE FROM dispassionate_reviews_sync_meta WHERE opportunity_id = ANY($1)', [opportunityIds]);
  } else {
    await pool.query('DELETE FROM dispassionate_reviews_sync_meta');
  }
}
