import "dotenv/config";

import { pool } from "../db/index.js";
import { closeConnection, executeQuery } from "../snowflake-connection.js";
import {
  buildScOpportunitiesQuery,
  buildScOpportunityBaseTargetQuery,
  buildScOpportunityTargetAmountsQuery,
  buildScOpportunitiesTargetedQuery,
} from "../snowflake-queries.js";
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

function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value));
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

function rowsByOpportunity(rows) {
  return new Map(
    rows.map((row) => [row.ID, JSON.stringify(normalizeValue(row))]),
  );
}

function compareRows(legacyRows, targetedRows) {
  const legacyById = rowsByOpportunity(legacyRows);
  const targetedById = rowsByOpportunity(targetedRows);
  let legacyOnly = 0;
  let targetedOnly = 0;
  let changed = 0;

  for (const [id, row] of legacyById) {
    if (!targetedById.has(id)) {
      legacyOnly += 1;
    } else if (targetedById.get(id) !== row) {
      changed += 1;
    }
  }
  for (const id of targetedById.keys()) {
    if (!legacyById.has(id)) targetedOnly += 1;
  }

  return {
    identical: legacyOnly === 0 && targetedOnly === 0 && changed === 0,
    legacyOnly,
    targetedOnly,
    changed,
  };
}

function buildTargets(baseRows, amountRows, arrThreshold) {
  const amounts = new Map(
    amountRows.map((row) => [row.OPPORTUNITY_ID, Number(row.AMOUNT)]),
  );
  const hasArrThreshold =
    arrThreshold !== null && arrThreshold !== undefined && !isNaN(arrThreshold);

  return baseRows
    .map((row) => ({
      id: row.OPPORTUNITY_ID,
      scUserId: row.SC_USER_ID,
      amount: amounts.get(row.OPPORTUNITY_ID) ?? null,
    }))
    .filter(
      (target) =>
        !hasArrThreshold ||
        (target.amount !== null && target.amount >= Number(arrThreshold)),
    );
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

async function getAppScope(appUserEmail, queryEmail, configuredScEmails) {
  const userResult = await pool.query(
    `SELECT id, sfdc_user_id, is_manager
     FROM users
     WHERE email = $1`,
    [appUserEmail],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new Error("No local app user found for BENCHMARK_USER_EMAIL");
  }

  const scope = await getEffectiveOppScope(user.id);
  if (!user.is_manager && !configuredScEmails) {
    scope.scEmails = [];
    scope.scUserIds = [];
  }
  scope.sfdcUserId = user.sfdc_user_id ?? null;

  let snowflakeUserIds;
  if (configuredScEmails) {
    snowflakeUserIds = await resolveScUserIds(configuredScEmails, queryEmail);
    scope.scEmails = configuredScEmails;
    scope.scUserIds = snowflakeUserIds;
  } else if (scope.scEmails.length > 0) {
    snowflakeUserIds =
      scope.scUserIds.length > 0
        ? scope.scUserIds
        : await resolveScUserIds(scope.scEmails, queryEmail);
  } else if (scope.sfdcUserId) {
    snowflakeUserIds = [scope.sfdcUserId];
  } else {
    throw new Error("The local app user has no cached Snowflake USER_ID");
  }

  if (snowflakeUserIds.length === 0) {
    throw new Error("No Snowflake USER_IDs resolved for the effective scope");
  }

  return { scope, snowflakeUserIds };
}

async function main() {
  const queryEmail = process.env.DEV_USER_EMAIL;
  if (!queryEmail) throw new Error("DEV_USER_EMAIL must be configured");

  // Establish the EXTERNALBROWSER connection with a real statement before the
  // scope resolver runs. In a short-lived Node benchmark, the SDK may otherwise
  // unref its transport immediately after the browser-auth callback.
  await executeQuery("SELECT 1", undefined, queryEmail);

  const appUserEmail = process.env.BENCHMARK_USER_EMAIL ?? queryEmail;
  const configuredScEmails = getConfiguredScEmails();
  const { scope, snowflakeUserIds } = await getAppScope(
    appUserEmail,
    queryEmail,
    configuredScEmails,
  );
  try {
    // Prevent a persisted Snowflake result from making either query appear fast.
    await executeWithTiming(
      queryEmail,
      "ALTER SESSION SET USE_CACHED_RESULT = FALSE",
    );

    const legacy = await executeWithTiming(
      queryEmail,
      buildScOpportunitiesQuery(snowflakeUserIds, scope),
    );
    const targetBase = await executeWithTiming(
      queryEmail,
      buildScOpportunityBaseTargetQuery(snowflakeUserIds, scope),
    );
    const targetAmounts = await executeWithTiming(
      queryEmail,
      buildScOpportunityTargetAmountsQuery(
        targetBase.rows.map((row) => row.OPPORTUNITY_ID),
      ),
    );
    const targets = buildTargets(
      targetBase.rows,
      targetAmounts.rows,
      scope.arrThreshold,
    );
    const targeted = await executeWithTiming(
      queryEmail,
      buildScOpportunitiesTargetedQuery(targets),
    );
    const equivalence = compareRows(legacy.rows, targeted.rows);
    const targetedElapsedMs =
      targetBase.elapsedMs + targetAmounts.elapsedMs + targeted.elapsedMs;

    console.log(
      JSON.stringify(
        {
          scope: {
            scCount: snowflakeUserIds.length,
            scopeSource: configuredScEmails
              ? "environment emails"
              : "app scope",
            managerSettingsEmail: appUserEmail,
            hasArrThreshold:
              scope.arrThreshold !== null && scope.arrThreshold !== undefined,
            hasCloseDateFrom: Boolean(scope.closeDateFrom),
            hasCloseDateTo: Boolean(scope.closeDateTo),
          },
          legacy: {
            elapsedMs: Number(legacy.elapsedMs.toFixed(1)),
            rows: legacy.rows.length,
            jsonBytes: jsonByteLength(legacy.rows),
          },
          targeted: {
            elapsedMs: Number(targetedElapsedMs.toFixed(1)),
            rows: targeted.rows.length,
            jsonBytes: jsonByteLength(targeted.rows),
            steps: {
              base: {
                elapsedMs: Number(targetBase.elapsedMs.toFixed(1)),
                rows: targetBase.rows.length,
              },
              amounts: {
                elapsedMs: Number(targetAmounts.elapsedMs.toFixed(1)),
                rows: targetAmounts.rows.length,
              },
              enrich: {
                elapsedMs: Number(targeted.elapsedMs.toFixed(1)),
                rows: targeted.rows.length,
              },
            },
          },
          improvement: {
            elapsedMs: Number(
              (legacy.elapsedMs - targetedElapsedMs).toFixed(1),
            ),
            percent: Number(
              ((1 - targetedElapsedMs / legacy.elapsedMs) * 100).toFixed(1),
            ),
          },
          equivalence,
        },
        null,
        2,
      ),
    );

    if (!equivalence.identical) {
      process.exitCode = 2;
    }
  } finally {
    await closeConnection(queryEmail);
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
