import { pool } from "../db/index.js";
import { executeQuery } from "../snowflake-connection.js";
import { buildGongCallsQuery } from "../snowflake-queries.js";

const CACHE_TTL_HOURS = 24;
const CACHE_VERSION = 3;

export async function getGongCallsForOpportunity(opportunityId, userEmail) {
  return syncGongCallsForOpportunities([opportunityId], userEmail);
}

export async function getGongCalls(userId, userEmail, scope = {}) {
  // Imported lazily to keep this shared mirror independent of the opportunity
  // cache module's startup path.
  const { getScOpportunities } = await import("./sc-opportunities-cache.js");
  const { opportunities } = await getScOpportunities(userId, userEmail, scope);
  const opportunityIds = opportunities
    .map((opportunity) => opportunity.id)
    .filter(Boolean);
  return syncGongCallsForOpportunities(opportunityIds, userEmail, {
    force: scope.force,
    opportunities,
  });
}

/**
 * Sync Gong calls for an already-materialized opportunity scope. Supplying the
 * just-refreshed opportunities makes the attendee account-name enrichment use
 * that same snapshot rather than whichever user's JSON cache was newest.
 *
 * @param {string[]} opportunityIds
 * @param {string} userEmail
 * @param {{ force?: boolean, opportunities?: Array<{ id?: string, account?: string }> }} [options]
 */
export async function syncGongCallsForOpportunities(
  opportunityIds,
  userEmail,
  options = {},
) {
  const ids = [...new Set(opportunityIds.filter(Boolean))];
  if (ids.length === 0) {
    return { calls: [], cached: true, cachedAt: null, syncedOpportunityCount: 0 };
  }

  const idsToSync = options.force ? ids : await getStaleOpportunityIds(ids);
  if (idsToSync.length > 0) {
    console.log(
      `[Gong Cache] ${options.force ? 'FORCE' : 'MISS'} - syncing ${idsToSync.length} opp(s) from Snowflake`,
    );
    await syncOpportunitiesFromSnowflake(
      idsToSync,
      userEmail,
      getProvidedAccountNames(options.opportunities, idsToSync),
    );
  } else {
    console.log(`[Gong Cache] HIT - all ${ids.length} opp(s) fresh`);
  }

  return {
    calls: await getCachedCalls(ids),
    cached: idsToSync.length === 0,
    cachedAt: await getOldestSyncTime(ids),
    syncedOpportunityCount: idsToSync.length,
  };
}

async function getStaleOpportunityIds(opportunityIds) {
  if (opportunityIds.length === 0) return [];
  const result = await pool.query(
    `SELECT opportunity_id FROM gong_sync_meta
     WHERE opportunity_id = ANY($1)
       AND last_synced_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'
       AND cache_version = $2`,
    [opportunityIds, CACHE_VERSION],
  );
  const freshIds = new Set(result.rows.map((row) => row.opportunity_id));
  return opportunityIds.filter((id) => !freshIds.has(id));
}

async function syncOpportunitiesFromSnowflake(
  opportunityIds,
  userEmail,
  providedAccountNames = new Map(),
) {
  const rows = await executeQuery(
    buildGongCallsQuery(opportunityIds),
    undefined,
    userEmail,
  );
  const accountNames = await getOpportunityAccountNames(
    opportunityIds,
    providedAccountNames,
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // This is a complete rolling-window refresh. Remove calls that have aged
    // out of the 30-day source query before replacing the current rows.
    await client.query(
      "DELETE FROM gong_calls WHERE opportunity_id = ANY($1)",
      [opportunityIds],
    );

    for (const row of rows) {
      await client.query(
        `INSERT INTO gong_calls
          (opportunity_id, conversation_key, call_id, call_date, title, brief, next_steps, key_points, attendees, gong_url, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (opportunity_id, conversation_key) DO UPDATE SET
           call_id = EXCLUDED.call_id,
           call_date = EXCLUDED.call_date,
           title = EXCLUDED.title,
           brief = EXCLUDED.brief,
           next_steps = EXCLUDED.next_steps,
           key_points = EXCLUDED.key_points,
           attendees = EXCLUDED.attendees,
           gong_url = EXCLUDED.gong_url,
           synced_at = NOW()`,
        [
          row.OPPORTUNITY_ID,
          row.CONVERSATION_KEY,
          row.CALL_ID,
          row.CALL_DATE,
          row.TITLE,
          row.BRIEF,
          row.NEXT_STEPS,
          row.KEY_POINTS == null ? null : JSON.stringify(row.KEY_POINTS),
          JSON.stringify(
            normalizeAttendees(
              row.ATTENDEES,
              accountNames.get(row.OPPORTUNITY_ID),
            ),
          ),
          row.GONG_URL,
        ],
      );
    }

    for (const opportunityId of opportunityIds) {
      await client.query(
        `INSERT INTO gong_sync_meta (opportunity_id, last_synced_at, cache_version)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (opportunity_id) DO UPDATE SET
           last_synced_at = NOW(),
           cache_version = EXCLUDED.cache_version`,
        [opportunityId, CACHE_VERSION],
      );
    }
    await client.query("COMMIT");
    console.log(
      `[Gong Cache] Synced ${rows.length} call(s) for ${opportunityIds.length} opp(s)`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function getProvidedAccountNames(opportunities = [], opportunityIds) {
  const requestedIds = new Set(opportunityIds);
  const accountNames = new Map();
  for (const opportunity of opportunities) {
    if (
      opportunity?.id &&
      requestedIds.has(opportunity.id) &&
      opportunity.account
    ) {
      accountNames.set(opportunity.id, opportunity.account);
    }
  }
  return accountNames;
}

async function getOpportunityAccountNames(
  opportunityIds,
  providedAccountNames = new Map(),
) {
  if (opportunityIds.length === 0) return new Map();

  const accountNames = new Map(providedAccountNames);
  const missingIds = opportunityIds.filter((id) => !accountNames.has(id));
  if (missingIds.length === 0) return accountNames;

  const result = await pool.query(
    `SELECT opportunity->>'id' AS opportunity_id, opportunity->>'account' AS account_name
     FROM sc_opportunities_cache,
          jsonb_array_elements(opportunities_data) AS opportunity
     WHERE opportunity->>'id' = ANY($1)
       AND NULLIF(opportunity->>'account', '') IS NOT NULL
     ORDER BY cached_at DESC`,
    [missingIds],
  );
  for (const row of result.rows) {
    if (!accountNames.has(row.opportunity_id)) {
      accountNames.set(row.opportunity_id, row.account_name);
    }
  }
  return accountNames;
}

function normalizeAttendees(attendees, accountName) {
  if (!Array.isArray(attendees)) return [];
  return attendees
    .filter((attendee) => attendee && attendee.name)
    .map((attendee) => {
      const affiliation = String(attendee.affiliation || "").toLowerCase();
      return {
        name: attendee.name,
        company:
          affiliation === "company" || affiliation === "zendesk"
            ? "Zendesk"
            : affiliation === "non_company"
              ? accountName || "unknown"
              : "unknown",
      };
    });
}

async function getCachedCalls(opportunityIds) {
  if (opportunityIds.length === 0) return [];
  const result = await pool.query(
    `SELECT * FROM gong_calls
     WHERE opportunity_id = ANY($1)
     ORDER BY opportunity_id, call_date DESC, call_id DESC`,
    [opportunityIds],
  );
  return result.rows.map(transformCall);
}

async function getOldestSyncTime(opportunityIds) {
  if (opportunityIds.length === 0) return null;
  const result = await pool.query(
    "SELECT MIN(last_synced_at) AS oldest FROM gong_sync_meta WHERE opportunity_id = ANY($1)",
    [opportunityIds],
  );
  return result.rows[0]?.oldest ?? null;
}

function toDateString(value) {
  return value ? new Date(value).toISOString().split("T")[0] : null;
}

function transformCall(row) {
  return {
    opportunityId: row.opportunity_id,
    conversationKey: row.conversation_key,
    callId: row.call_id,
    callDate: toDateString(row.call_date),
    title: row.title,
    brief: row.brief,
    nextSteps: row.next_steps,
    keyPoints: Array.isArray(row.key_points) ? row.key_points : [],
    attendees: Array.isArray(row.attendees) ? row.attendees : [],
    gongUrl: row.gong_url,
    isEnriched: Boolean(row.call_id && row.gong_url),
    syncedAt: row.synced_at ? row.synced_at.toISOString() : null,
  };
}

export async function invalidateGongCallsCache(opportunityIds) {
  if (opportunityIds && opportunityIds.length > 0) {
    await pool.query(
      "DELETE FROM gong_sync_meta WHERE opportunity_id = ANY($1)",
      [opportunityIds],
    );
  } else {
    await pool.query("DELETE FROM gong_sync_meta");
  }
}
