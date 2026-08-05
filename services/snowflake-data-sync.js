import { getActivities } from "./activities-cache.js";
import { syncDispassionateReviewsForOpportunities } from "./dispassionate-reviews-cache.js";
import { syncGongCallsForOpportunities } from "./gong-calls-cache.js";
import { getScOpportunities } from "./sc-opportunities-cache.js";
import { getBlindSpots } from "./blind-spots-cache.js";
import {
  finishSyncDomain,
  finishSyncRun,
  startSyncDomain,
  startSyncRun,
} from "./sync-runs.js";

// A second click (or another open tab) for the same app user should join the
// current run, never interleave a second set of cache writes with it. The entry
// is intentionally process-local: it protects the normal same-server case,
// while the cache rows themselves stay safe/idempotent across processes.
const inFlightSyncs = new Map();

/**
 * Materialize one coherent, scoped Snowflake refresh.
 *
 * Opportunities and Activities are independent, so their optimized source
 * pulls start together. Blind Spots is fetched alongside them. D-Score reviews and Gong calls then run together using
 * the exact fresh opportunity IDs (and fresh account names for Gong attendee
 * enrichment). The caller receives success only after every domain has
 * completed, allowing the UI to refetch its local reads as a single step.
 *
 * @param {{ userId: number, userEmail: string, scope: object, activityScope: object, blindSpotsScope: object }} options
 */
export function syncScopedSnowflakeData(options) {
  const existing = inFlightSyncs.get(options.userId);
  if (existing) return existing;

  const run = performSync(options).finally(() => {
    if (inFlightSyncs.get(options.userId) === run) {
      inFlightSyncs.delete(options.userId);
    }
  });
  inFlightSyncs.set(options.userId, run);
  return run;
}

async function performSync({
  userId,
  userEmail,
  scope,
  activityScope,
  blindSpotsScope,
}) {
  const runId = await startSyncRun(userId, {
    arrThreshold: scope.arrThreshold ?? null,
    closeDatePreset: scope.closeDatePreset ?? null,
    closeDateFrom: scope.closeDateFrom ?? null,
    closeDateTo: scope.closeDateTo ?? null,
    scEmails: Array.isArray(scope.scEmails) ? scope.scEmails : [],
  });
  try {
    return await performSyncRun({
      userId,
      userEmail,
      scope,
      activityScope,
      blindSpotsScope,
      runId,
    });
  } catch (error) {
    await finishSyncRun(runId, error.message);
    throw error;
  }
}

async function performSyncRun({
  userId,
  userEmail,
  scope,
  activityScope,
  blindSpotsScope,
  runId,
}) {
  const startedAt = new Date();
  const totalStarted = performance.now();

  console.log(`[Snowflake Sync] ${runId} started for user ${userId}`);

  // These paths are independent and each is already a targeted source query:
  // - Opportunities resolves its small SC target ID set before enrichment.
  // - Activities reads only the latest activity snapshot, not every history row.
  // - Blind Spots applies the separate AE/no-SC scope and writes its own cache.
  const [opportunityDomain, activityDomain, blindSpotsDomain] = await runDomains([
    measureDomain("opportunities", runId, async () => {
      const result = await getScOpportunities(userId, userEmail, {
        ...scope,
        force: true,
      });
      return {
        result,
        records: result.opportunities.length,
        syncedTargets: result.opportunities.length,
      };
    }),
    measureDomain("activities", runId, async () => {
      const result = await getActivities(userEmail, {
        ...activityScope,
        force: true,
      });
      return {
        result,
        records: result.activities.length,
        syncedTargets: result.activities.length,
      };
    }),
    measureDomain("blindSpots", runId, async () => {
      const result = await getBlindSpots(userId, userEmail, {
        ...blindSpotsScope,
        force: true,
      });
      return {
        result,
        records: result.opportunities.length,
        syncedTargets: result.opportunities.length,
      };
    }),
  ]);

  const opportunities = opportunityDomain.result.opportunities;
  const opportunityIds = opportunities.map((opportunity) => opportunity.id);

  // Reviews and calls are intentionally not lazy detail-page side effects in
  // this flow. Both consume the same freshly-materialized opportunity set.
  const [reviewDomain, gongDomain] = await runDomains([
    measureDomain("dispassionateReviews", runId, async () => {
      const result = await syncDispassionateReviewsForOpportunities(
        opportunityIds,
        userEmail,
        { force: true },
      );
      return {
        result,
        records: result.reviews.length,
        syncedTargets: result.syncedOpportunityCount,
      };
    }),
    measureDomain("gongCalls", runId, async () => {
      const result = await syncGongCallsForOpportunities(
        opportunityIds,
        userEmail,
        { force: true, opportunities },
      );
      return {
        result,
        records: result.calls.length,
        syncedTargets: result.syncedOpportunityCount,
      };
    }),
  ]);

  const completedAt = new Date();
  const durationMs = Math.round(performance.now() - totalStarted);
  const result = {
    runId,
    startedAt,
    completedAt,
    durationMs,
    scope: {
      arrThreshold: scope.arrThreshold ?? null,
      closeDatePreset: scope.closeDatePreset ?? null,
      closeDateFrom: scope.closeDateFrom ?? null,
      closeDateTo: scope.closeDateTo ?? null,
      scEmails: Array.isArray(scope.scEmails) ? scope.scEmails : [],
    },
    domains: {
      opportunities: summarizeDomain(opportunityDomain),
      activities: summarizeDomain(activityDomain),
      blindSpots: summarizeDomain(blindSpotsDomain),
      dispassionateReviews: summarizeDomain(reviewDomain),
      gongCalls: summarizeDomain(gongDomain),
    },
  };

  await finishSyncRun(runId);

  console.log(
    `[Snowflake Sync] ${runId} completed in ${durationMs}ms ` +
      `(opps ${result.domains.opportunities.durationMs}ms, ` +
      `activities ${result.domains.activities.durationMs}ms, ` +
      `reviews ${result.domains.dispassionateReviews.durationMs}ms, ` +
      `gong ${result.domains.gongCalls.durationMs}ms)`,
  );

  return result;
}

async function measureDomain(name, syncRunId, work) {
  const started = performance.now();
  await startSyncDomain(syncRunId, name);
  try {
    const { result, records, syncedTargets } = await work();
    const durationMs = Math.round(performance.now() - started);
    await finishSyncDomain(syncRunId, name, {
      status: "succeeded",
      durationMs,
      records,
      syncedTargets,
    });
    return { name, result, records, syncedTargets, durationMs };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    await finishSyncDomain(syncRunId, name, {
      status: "failed",
      durationMs,
      error: error.message,
    });
    throw error;
  }
}

async function runDomains(promises) {
  const settled = await Promise.allSettled(promises);
  const failed = settled.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return settled.map((result) => result.value);
}

function summarizeDomain(domain) {
  return {
    durationMs: domain.durationMs,
    records: domain.records,
    syncedTargets: domain.syncedTargets,
    cached: domain.result.cached,
    cachedAt: domain.result.cachedAt ?? null,
  };
}
