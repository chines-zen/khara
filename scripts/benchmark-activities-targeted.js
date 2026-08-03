import "dotenv/config";

import { pool } from "../db/index.js";
import { closeConnection, executeQuery } from "../snowflake-connection.js";
import {
  buildActivitiesLatestSnapshotDateQuery,
  buildActivitiesSnapshotDateTargetQuery,
  buildActivitiesQuery,
} from "../snowflake-queries.js";
import { getFiscalYearRange } from "../fiscal-quarter.js";
import { getEffectiveOppScope } from "../services/opp-scope.js";
import { resolveScUserIds } from "../services/sc-lookup.js";

async function executeWithTiming(email, sql) {
  const startedAt = performance.now();
  const rows = await executeQuery(sql, undefined, email);
  return {
    elapsedMs: performance.now() - startedAt,
    rows,
  };
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeValue(child)]),
    );
  }
  return value;
}

function rowsById(rows, omitActivityMatchOppName = false) {
  return new Map(
    rows.map((row) => {
      const normalized = normalizeValue(row);
      if (omitActivityMatchOppName) {
        delete normalized.ACTIVITY_MATCH_OPP_NAME;
      }
      return [row.ID, JSON.stringify(normalized)];
    }),
  );
}

function toIsoDate(value) {
  if (value instanceof Date) return value.toISOString().split("T")[0];
  return value ? String(value).split("T")[0] : null;
}

function compareRows(legacyRows, targetRows) {
  const legacyById = rowsById(legacyRows);
  const targetById = rowsById(targetRows);
  const legacyWithoutOppName = rowsById(legacyRows, true);
  const targetWithoutOppName = rowsById(targetRows, true);
  let legacyOnly = 0;
  let targetOnly = 0;
  let changedOtherFields = 0;
  const canonicalizedOpportunityNames = [];

  for (const [id, row] of legacyById) {
    if (!targetById.has(id)) {
      legacyOnly += 1;
    } else if (targetById.get(id) !== row) {
      if (targetWithoutOppName.get(id) !== legacyWithoutOppName.get(id)) {
        changedOtherFields += 1;
      } else {
        canonicalizedOpportunityNames.push({
          id,
          legacy: legacyRows.find((candidate) => candidate.ID === id)
            .ACTIVITY_MATCH_OPP_NAME,
          target: targetRows.find((candidate) => candidate.ID === id)
            .ACTIVITY_MATCH_OPP_NAME,
        });
      }
    }
  }
  for (const id of targetById.keys()) {
    if (!legacyById.has(id)) targetOnly += 1;
  }

  return {
    semanticallyEquivalent:
      legacyRows.length === legacyById.size &&
      targetRows.length === targetById.size &&
      legacyOnly === 0 &&
      targetOnly === 0 &&
      changedOtherFields === 0,
    legacyOnly,
    targetOnly,
    changedOtherFields,
    canonicalizedOpportunityNames,
    legacyDuplicates: legacyRows.length - legacyById.size,
    targetDuplicates: targetRows.length - targetById.size,
  };
}

async function getActivityScope(email) {
  const userResult = await pool.query(
    `SELECT id, sfdc_user_id, is_manager
     FROM users
     WHERE email = $1`,
    [email],
  );
  const user = userResult.rows[0];
  if (!user) throw new Error("No local app user found for DEV_USER_EMAIL");

  const scope = await getEffectiveOppScope(user.id);
  const scEmails = user.is_manager ? scope.scEmails : [];
  const scUserIds = user.is_manager ? scope.scUserIds : [];

  if (scEmails.length > 0) {
    const ids =
      scUserIds.length > 0
        ? scUserIds
        : await resolveScUserIds(scEmails, email);
    if (ids.length > 0) return ids;
  }

  if (user.sfdc_user_id) return [user.sfdc_user_id];
  throw new Error("The local app user has no cached Snowflake USER_ID");
}

function getConfiguredCreatedByIds() {
  const rawIds = process.env.ACTIVITIES_BENCHMARK_CREATED_BY_IDS;
  if (!rawIds) return null;

  const ids = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error(
      "ACTIVITIES_BENCHMARK_CREATED_BY_IDS must contain at least one USER_ID",
    );
  }
  return ids;
}

function getConfiguredScEmails() {
  const rawEmails = process.env.BENCHMARK_SC_EMAILS;
  if (!rawEmails) return null;

  const emails = rawEmails
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    throw new Error("BENCHMARK_SC_EMAILS must contain at least one email");
  }
  return emails;
}

async function main() {
  const email = process.env.DEV_USER_EMAIL;
  if (!email) throw new Error("DEV_USER_EMAIL must be configured");

  // Establish the EXTERNALBROWSER connection with a real statement before the
  // scope resolver runs. In a short-lived Node benchmark, the SDK may otherwise
  // unref its transport immediately after the browser-auth callback.
  await executeQuery("SELECT 1", undefined, email);

  const configuredCreatedByIds = getConfiguredCreatedByIds();
  const configuredScEmails = getConfiguredScEmails();
  const createdByIds =
    configuredCreatedByIds ??
    (configuredScEmails
      ? await resolveScUserIds(configuredScEmails, email)
      : await getActivityScope(email));
  const range = getFiscalYearRange();
  try {
    // Both statements must execute against the warehouse, not Snowflake's
    // persisted-result cache, or the comparison hides the real scan cost.
    await executeWithTiming(
      email,
      "ALTER SESSION SET USE_CACHED_RESULT = FALSE",
    );

    const legacy = await executeWithTiming(
      email,
      buildActivitiesQuery(createdByIds, {
        fromDate: range.from,
        toDate: range.to,
      }),
    );
    const snapshotDate = await executeWithTiming(
      email,
      buildActivitiesLatestSnapshotDateQuery(),
    );
    const latestSnapshotDate = toIsoDate(
      snapshotDate.rows[0]?.SOURCE_SNAPSHOT_DATE,
    );
    const literalTarget = await executeWithTiming(
      email,
      buildActivitiesSnapshotDateTargetQuery(createdByIds, {
        fromDate: range.from,
        toDate: range.to,
        sourceSnapshotDate: latestSnapshotDate,
      }),
    );
    const literalEquivalence = compareRows(legacy.rows, literalTarget.rows);

    console.log(
      JSON.stringify(
        {
          scope: {
            createdByCount: createdByIds.length,
            source: configuredCreatedByIds
              ? "environment user IDs"
              : configuredScEmails
                ? "environment emails"
                : "app scope",
            fiscalYear: range,
          },
          legacy: {
            elapsedMs: Number(legacy.elapsedMs.toFixed(1)),
            rows: legacy.rows.length,
            jsonBytes: Buffer.byteLength(JSON.stringify(legacy.rows)),
          },
          literalTarget: {
            snapshotDate: latestSnapshotDate,
            latestSnapshotLookup: {
              elapsedMs: Number(snapshotDate.elapsedMs.toFixed(1)),
            },
            dataQuery: {
              elapsedMs: Number(literalTarget.elapsedMs.toFixed(1)),
              rows: literalTarget.rows.length,
              jsonBytes: Buffer.byteLength(JSON.stringify(literalTarget.rows)),
            },
            totalElapsedMs: Number(
              (snapshotDate.elapsedMs + literalTarget.elapsedMs).toFixed(1),
            ),
          },
          literalImprovement: {
            elapsedMs: Number(
              (
                legacy.elapsedMs -
                snapshotDate.elapsedMs -
                literalTarget.elapsedMs
              ).toFixed(1),
            ),
            percent: Number(
              (
                (1 -
                  (snapshotDate.elapsedMs + literalTarget.elapsedMs) /
                    legacy.elapsedMs) *
                100
              ).toFixed(1),
            ),
          },
          equivalence: literalEquivalence,
        },
        null,
        2,
      ),
    );

    if (!literalEquivalence.semanticallyEquivalent) process.exitCode = 2;
  } finally {
    await closeConnection(email);
  }
}

// snowflake-sdk unrefs its transport after EXTERNALBROWSER authentication. An
// unresolved query callback alone does not keep Node alive, so retain a small
// handle for the duration of this standalone benchmark.
const keepAlive = setInterval(() => {}, 1_000);
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearInterval(keepAlive);
  await pool.end();
}
