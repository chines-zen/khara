import { randomUUID } from "node:crypto";
import { getActivities } from "./activities-cache.js";
import { syncDispassionateReviewsForOpportunities } from "./dispassionate-reviews-cache.js";
import { syncGongCallsForOpportunities } from "./gong-calls-cache.js";
import { getScOpportunities } from "./sc-opportunities-cache.js";

// A second click (or another open tab) for the same app user should join the
// current run, never interleave a second set of cache writes with it. The entry
// is intentionally process-local: it protects the normal same-server case,
// while the cache rows themselves stay safe/idempotent across processes.
const inFlightSyncs = new Map();

/**
 * Materialize one coherent, scoped Snowflake refresh.
 *
 * Opportunities and Activities are independent, so their optimized source
 * pulls start together. D-Score reviews and Gong calls then run together using
 * the exact fresh opportunity IDs (and fresh account names for Gong attendee
 * enrichment). The caller receives success only after every domain has
 * completed, allowing the UI to refetch its local reads as a single step.
 *
 * @param {{ userId: number, userEmail: string, scope: object, activityScope: object }} options
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

async function performSync({ userId, userEmail, scope, activityScope }) {
  const runId = randomUUID();
  const startedAt = new Date();
  const totalStarted = performance.now();

  console.log(`[Snowflake Sync] ${runId} started for user ${userId}`);

  // These paths are independent and each is already a targeted source query:
  // - Opportunities resolves its small SC target ID set before enrichment.
  // - Activities reads only the latest activity snapshot, not every history row.
  const [opportunityDomain, activityDomain] = await Promise.all([
    measureDomain("opportunities", async () => {
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
    measureDomain("activities", async () => {
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
  ]);

  const opportunities = opportunityDomain.result.opportunities;
  const opportunityIds = opportunities.map((opportunity) => opportunity.id);

  // Reviews and calls are intentionally not lazy detail-page side effects in
  // this flow. Both consume the same freshly-materialized opportunity set.
  const [reviewDomain, gongDomain] = await Promise.all([
    measureDomain("dispassionateReviews", async () => {
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
    measureDomain("gongCalls", async () => {
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
      dispassionateReviews: summarizeDomain(reviewDomain),
      gongCalls: summarizeDomain(gongDomain),
    },
  };

  console.log(
    `[Snowflake Sync] ${runId} completed in ${durationMs}ms ` +
      `(opps ${result.domains.opportunities.durationMs}ms, ` +
      `activities ${result.domains.activities.durationMs}ms, ` +
      `reviews ${result.domains.dispassionateReviews.durationMs}ms, ` +
      `gong ${result.domains.gongCalls.durationMs}ms)`,
  );

  return result;
}

async function measureDomain(name, work) {
  const started = performance.now();
  const { result, records, syncedTargets } = await work();
  return {
    name,
    result,
    records,
    syncedTargets,
    durationMs: Math.round(performance.now() - started),
  };
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
