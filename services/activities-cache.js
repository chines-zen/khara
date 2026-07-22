import { pool } from '../db/index.js';
import { executeQuery } from '../snowflake-connection.js';
import { buildActivitiesQuery } from '../snowflake-queries.js';
import { resolveScUserId, resolveScUserIds } from './sc-lookup.js';
import { getFiscalYearRange } from '../fiscal-quarter.js';

const CACHE_TTL_HOURS = 12;

/**
 * Get activities for an SE (or, manager-only, a set of SEs) with a 12-hour
 * per-SE cache. Mirrors services/sc-opportunities-cache.js's cache-aside
 * shape, but as a flat per-row Postgres mirror of SA_ACTIVITY_DAILY_SNAPSHOT
 * instead of a per-user JSONB blob, since activities are shared/report-only
 * data rather than something scoped and stored per requesting app user.
 *
 * Scoped by who *created* the activity record (CREATED_BY_ID), not who it's
 * assigned to (OWNER_ID) - see buildActivitiesQuery for why.
 * @param {string} userEmail - identity to run Snowflake queries as
 * @param {{ scEmails?: string[] }} [scope] - manager-only: scope to these SEs
 *   instead of userEmail's own identity
 */
export async function getActivities(userEmail, scope = {}) {
  const { scEmails = [] } = scope;

  const createdByIds = await resolveCreatedByIds(userEmail, scEmails);
  if (createdByIds.length === 0) {
    throw new Error(`No Snowflake user found for: ${scEmails.length > 0 ? scEmails.join(', ') : userEmail}`);
  }

  const staleIds = await getStaleCreatedByIds(createdByIds);
  if (staleIds.length > 0) {
    console.log(`[Activities Cache] MISS - syncing ${staleIds.length} SE(s) from Snowflake`);
    await syncCreatedByFromSnowflake(staleIds, userEmail);
  } else {
    console.log(`[Activities Cache] HIT - all ${createdByIds.length} SE(s) fresh`);
  }

  const activities = await getCachedActivities(createdByIds);
  const cachedAt = await getOldestSyncTime(createdByIds);

  return { activities, cached: staleIds.length === 0, cachedAt };
}

async function resolveCreatedByIds(userEmail, scEmails) {
  if (scEmails.length > 0) {
    return resolveScUserIds(scEmails, userEmail);
  }

  const scUser = await resolveScUserId(userEmail);
  return scUser ? [scUser.userId] : [];
}

async function getStaleCreatedByIds(createdByIds) {
  const result = await pool.query(
    `SELECT created_by_id FROM activities_sync_meta
     WHERE created_by_id = ANY($1) AND last_synced_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
    [createdByIds],
  );
  const freshIds = new Set(result.rows.map((r) => r.created_by_id));
  return createdByIds.filter((id) => !freshIds.has(id));
}

async function getOldestSyncTime(createdByIds) {
  const result = await pool.query(
    `SELECT MIN(last_synced_at) AS oldest FROM activities_sync_meta WHERE created_by_id = ANY($1)`,
    [createdByIds],
  );
  return result.rows[0]?.oldest ?? null;
}

async function syncCreatedByFromSnowflake(createdByIds, userEmail) {
  const { from, to } = getFiscalYearRange();
  const sql = buildActivitiesQuery(createdByIds, { fromDate: from, toDate: to });
  const rows = await executeQuery(sql, undefined, userEmail);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      await client.query(
        `INSERT INTO activities (
           id, account_id, account_name, activity_date, activity_month,
           activity_year_quarter, activity_year_month, subject, type, sub_type,
           duration_hours, owner_id, owner_name, owner_role, created_by_id, created_by_name,
           whatid, whatid_type, activity_match_opp_name, activity_match_account_name,
           is_sales_activity, source_snapshot_date, synced_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           account_name = EXCLUDED.account_name,
           activity_date = EXCLUDED.activity_date,
           activity_month = EXCLUDED.activity_month,
           activity_year_quarter = EXCLUDED.activity_year_quarter,
           activity_year_month = EXCLUDED.activity_year_month,
           subject = EXCLUDED.subject,
           type = EXCLUDED.type,
           sub_type = EXCLUDED.sub_type,
           duration_hours = EXCLUDED.duration_hours,
           owner_id = EXCLUDED.owner_id,
           owner_name = EXCLUDED.owner_name,
           owner_role = EXCLUDED.owner_role,
           created_by_id = EXCLUDED.created_by_id,
           created_by_name = EXCLUDED.created_by_name,
           whatid = EXCLUDED.whatid,
           whatid_type = EXCLUDED.whatid_type,
           activity_match_opp_name = EXCLUDED.activity_match_opp_name,
           activity_match_account_name = EXCLUDED.activity_match_account_name,
           is_sales_activity = EXCLUDED.is_sales_activity,
           source_snapshot_date = EXCLUDED.source_snapshot_date,
           synced_at = NOW()`,
        [
          row.ID, row.ACCOUNT_ID, row.ACCOUNT_NAME, row.ACTIVITY_DATE, row.ACTIVITY_MONTH,
          row.ACTIVITY_YEAR_QUARTER, row.ACTIVITY_YEAR_MONTH, row.SUBJECT, row.TYPE, row.SUB_TYPE,
          row.DURATION_HOURS, row.OWNER_ID, row.OWNER_NAME, row.OWNER_ROLE, row.CREATED_BY_ID, row.CREATED_BY_NAME,
          row.WHATID, row.WHATID_TYPE, row.ACTIVITY_MATCH_OPP_NAME, row.ACTIVITY_MATCH_ACCOUNT_NAME,
          row.IS_SALES_ACTIVITY, row.SOURCE_SNAPSHOT_DATE,
        ],
      );
    }

    for (const createdById of createdByIds) {
      await client.query(
        `INSERT INTO activities_sync_meta (created_by_id, last_synced_at)
         VALUES ($1, NOW())
         ON CONFLICT (created_by_id) DO UPDATE SET last_synced_at = NOW()`,
        [createdById],
      );
    }

    await client.query('COMMIT');
    console.log(`[Activities Cache] Synced ${rows.length} activities for ${createdByIds.length} SE(s)`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getCachedActivities(createdByIds) {
  const result = await pool.query(
    `SELECT * FROM activities WHERE created_by_id = ANY($1) ORDER BY activity_date DESC`,
    [createdByIds],
  );
  return result.rows.map(transformActivity);
}

function transformActivity(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    activityDate: row.activity_date ? row.activity_date.toISOString().split('T')[0] : null,
    activityMonth: row.activity_month ? row.activity_month.toISOString().split('T')[0] : null,
    activityYearQuarter: row.activity_year_quarter,
    activityYearMonth: row.activity_year_month,
    subject: row.subject,
    type: row.type,
    subType: row.sub_type,
    durationHours: row.duration_hours !== null ? Number(row.duration_hours) : 0,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerRole: row.owner_role,
    createdById: row.created_by_id,
    createdByName: row.created_by_name,
    whatid: row.whatid,
    whatidType: row.whatid_type,
    activityMatchOppName: row.activity_match_opp_name,
    activityMatchAccountName: row.activity_match_account_name,
    isSalesActivity: row.is_sales_activity,
    sourceSnapshotDate: row.source_snapshot_date ? row.source_snapshot_date.toISOString().split('T')[0] : null,
  };
}

/**
 * Most recent sync across all SEs - i.e. when the app last synced any
 * activity data from Snowflake.
 */
export async function getLastActivitiesSync() {
  const result = await pool.query('SELECT MAX(last_synced_at) AS last_synced_at FROM activities_sync_meta');
  return result.rows[0]?.last_synced_at ?? null;
}

/**
 * Force a resync on next request by dropping sync-meta rows for these SEs
 * (or all SEs if none specified). The mirrored activity rows are left in
 * place - they'll be overwritten by the next sync's upsert.
 */
export async function invalidateActivitiesCache(createdByIds) {
  if (createdByIds && createdByIds.length > 0) {
    await pool.query('DELETE FROM activities_sync_meta WHERE created_by_id = ANY($1)', [createdByIds]);
  } else {
    await pool.query('DELETE FROM activities_sync_meta');
  }
}
