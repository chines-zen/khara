import { TEST_OPP_IDS, isTestOppsEnabled } from './services/test-opps.js';

/**
 * Build SQL query for fetching opportunities with all required fields
 */
export function buildOpportunitiesQuery(filters = {}) {
  const { search, stages, owner, closeMonths, daysSinceMax, arrMin, opportunityIds, scUserId, closeDateFrom, closeDateTo } = filters;

  // Base query with all fields from DIM and staging
  let sql = `
SELECT
    -- Core fields from DIM
    dim.CRM_OPPORTUNITY_ID AS id,
    -- dim.OPPORTUNITY_NAME is masked (always NULL) — use the unmasked staging name instead
    stg.NAME AS name,
    acc.NAME AS account,
    dim.OPPORTUNITY_STAGE_NAME AS stage,
    dim.OPPORTUNITY_TYPE AS type,
    -- dim.OPPORTUNITY_TERRITORY_NAME is always empty at the source — resolve territory via the
    -- account's assigned territory ID against the sales roster instead (verified against live data)
    roster.TERRITORY_NAME AS territory,
    dim.CALENDAR_CLOSEDATE AS close_date,
    dim.OPPORTUNITY_CREATED_DATE AS created_date,

    -- Owner: CURATED_OPPORTUNITIES_HISTORY.OWNER_ACTUAL_NAME__C_OPPT is the most reliable source
    -- (confirmed against known-good cases); fall back to funnel metrics when an opp isn't in that
    -- table. SA_ACTIVITY_DAILY_SNAPSHOT was tested and dropped — lowest coverage (3%) and, when it
    -- disagreed with funnel, it matched the curated table only 0.7% of the time (verified against live data)
    COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME) AS owner,

    -- Notes from staging (not in DIM)
    stg.RED_FLAGS_C AS sc_notes,
    stg.NEXT_STEP_C AS next_steps,
    stg.MANAGER_NOTES_C AS manager_notes,
    stg.PRODUCT_SPECIALIST_NOTES_C AS product_specialist_notes,

    -- SC Manager Notes: dim.OPPORTUNITY_SC_MANAGER_NOTES is always empty at the source —
    -- the populated column is SC_MANAGER_NOTES_C on the SFDC fields snapshot (verified against live data)
    sfdc_fields.SC_MANAGER_NOTES_C AS sc_manager_notes,

    -- SC info
    dim.OPPORTUNITY_SERVICES_ENGAGED AS sc_engagement_type,
    sc_user.FULL_NAME AS name_of_sc,
    stg.NAME_OF_SC_C AS sc_user_id,

    -- D-Score from DIM
    dim.OPPORTUNITY_D_SCORE_LATEST AS d_score,

    -- Opportunity number from staging
    stg.OPPORTUNITY_NUMBER_C AS opportunity_number,

    -- Amount from PRESENTATION layer
    arr.product_arr_usd AS amount,

    -- Snapshot dates
    dim.SOURCE_SNAPSHOT_DATE AS snapshot_date,
    dim.RUN_DATE

FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim

-- Join staging for fields not in DIM (needed first for ACCOUNT_ID)
-- Verified in FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2: the "current row"
-- sentinel here is VALID_TO_TIMESTAMP = '9999-12-31', not NULL (confirmed against live data)
LEFT JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2 stg
    ON dim.CRM_OPPORTUNITY_ID = stg.ID
    AND stg.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'

-- Join for account name (using ACCOUNT_ID from staging)
LEFT JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2 acc
    ON stg.ACCOUNT_ID = acc.ID
    AND acc.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'

-- Join for SC name (deduplicate USER_HISTORY)
LEFT JOIN (
    SELECT
        USER_ID,
        FULL_NAME,
        EMAIL
    FROM FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY
    QUALIFY ROW_NUMBER() OVER (PARTITION BY USER_ID ORDER BY USER_ID) = 1
) sc_user
    ON stg.NAME_OF_SC_C = sc_user.USER_ID

-- Join for owner name from curated opportunity history (primary owner source)
LEFT JOIN (
    SELECT
        CRM_OPPORTUNITY_ID,
        OWNER_ACTUAL_NAME__C_OPPT
    FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY
    WHERE SOURCE_SNAPSHOT_DATE = (SELECT MAX(SOURCE_SNAPSHOT_DATE) FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY CRM_OPPORTUNITY_ID ORDER BY CRM_OPPORTUNITY_ID) = 1
) curated
    ON dim.CRM_OPPORTUNITY_ID = curated.CRM_OPPORTUNITY_ID

-- Join for owner name from funnel metrics (fallback for opps not in curated history)
LEFT JOIN (
    SELECT
        OPPORTUNITY_ID,
        OPP_OWNER_NAME,
        SNAPSHOT_DATE
    FROM FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT
    QUALIFY ROW_NUMBER() OVER (PARTITION BY OPPORTUNITY_ID ORDER BY SNAPSHOT_DATE DESC) = 1
) funnel
    ON dim.CRM_OPPORTUNITY_ID = funnel.OPPORTUNITY_ID

-- Join for amount from PRESENTATION layer
LEFT JOIN (
    SELECT
        crm_opportunity_id,
        SUM(product_arr_usd) AS product_arr_usd,
        source_snapshot_date
    FROM PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING
    WHERE is_total_booking = 1
    GROUP BY crm_opportunity_id, source_snapshot_date
    QUALIFY ROW_NUMBER() OVER (PARTITION BY crm_opportunity_id ORDER BY source_snapshot_date DESC) = 1
) arr
    ON dim.CRM_OPPORTUNITY_ID = arr.crm_opportunity_id

-- Join for SC Manager Notes (daily snapshot; dedupe to most recent SOURCE_SNAPSHOT_DATE)
LEFT JOIN (
    SELECT
        ID,
        SC_MANAGER_NOTES_C
    FROM FUNCTIONAL.GTM_SALES_OPS.DIM_CRM_OPPORTUNITIES_SFDC_FIELDS_DAILY_SNAPSHOT
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY SOURCE_SNAPSHOT_DATE DESC) = 1
) sfdc_fields
    ON dim.CRM_OPPORTUNITY_ID = sfdc_fields.ID

-- Join for territory name via the account's assigned territory (dedupe roster to one row per territory)
LEFT JOIN (
    SELECT
        TERRITORY_ID,
        TERRITORY_NAME
    FROM FUNCTIONAL.GTM_SALES_OPS.ROSTER
    WHERE TERRITORY_NAME IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY TERRITORY_ID ORDER BY TERRITORY_ID) = 1
) roster
    ON acc.ASSIGNED_TERRITORY_ID_C = roster.TERRITORY_ID

WHERE dim.RUN_DATE = (
    SELECT MAX(RUN_DATE)
    FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
)
`;

  // Add filters
  const conditions = [];

  // Specific opportunity IDs filter (for testing)
  if (opportunityIds && opportunityIds.length > 0) {
    const idList = opportunityIds.map(id => `'${id}'`).join(', ');
    conditions.push(`dim.CRM_OPPORTUNITY_ID IN (${idList})`);
  }

  // Search filter
  if (search && search.trim()) {
    const searchTerm = search.trim().replace(/'/g, "''"); // Escape single quotes
    conditions.push(`(
      LOWER(stg.NAME) LIKE LOWER('%${searchTerm}%')
      OR LOWER(acc.NAME) LIKE LOWER('%${searchTerm}%')
      OR LOWER(COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME)) LIKE LOWER('%${searchTerm}%')
    )`);
  }

  // Stage filter
  if (stages && stages.length > 0) {
    const stageList = stages.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
    conditions.push(`dim.OPPORTUNITY_STAGE_NAME IN (${stageList})`);
  }

  // Owner filter
  if (owner) {
    const ownerEscaped = owner.replace(/'/g, "''");
    conditions.push(`COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME) = '${ownerEscaped}'`);
  }

  // SC identity filter (scope to opportunities where this Snowflake user is the assigned SC)
  if (scUserId) {
    const scUserIdEscaped = scUserId.replace(/'/g, "''");
    conditions.push(`stg.NAME_OF_SC_C = '${scUserIdEscaped}'`);
  }

  // Close month filter
  if (closeMonths && closeMonths.length > 0) {
    const monthList = closeMonths.map(m => `'${m}'`).join(', ');
    conditions.push(`TO_CHAR(dim.CALENDAR_CLOSEDATE, 'YYYY-MM') IN (${monthList})`);
  }

  // Close date range filter (e.g. fiscal quarter scoping)
  if (closeDateFrom) {
    const fromEscaped = closeDateFrom.replace(/'/g, "''");
    conditions.push(`dim.CALENDAR_CLOSEDATE >= '${fromEscaped}'`);
  }
  if (closeDateTo) {
    const toEscaped = closeDateTo.replace(/'/g, "''");
    conditions.push(`dim.CALENDAR_CLOSEDATE <= '${toEscaped}'`);
  }

  // Days since D-Score filter
  if (daysSinceMax !== null && daysSinceMax !== undefined && !isNaN(daysSinceMax)) {
    conditions.push(`DATEDIFF('day', dim.SOURCE_SNAPSHOT_DATE, CURRENT_DATE()) <= ${daysSinceMax}`);
  }

  // ARR Minimum filter
  if (arrMin !== null && arrMin !== undefined && !isNaN(arrMin)) {
    conditions.push(`arr.product_arr_usd >= ${arrMin}`);
  }

  // Add all conditions to WHERE clause
  if (conditions.length > 0) {
    sql += `\n  AND ${conditions.join('\n  AND ')}`;
  }

  sql += `\nORDER BY stg.NAME`;

  return sql;
}

/**
 * Build query for the most recent Snowflake data refresh (RUN_DATE), the
 * same recency marker the opportunities queries filter on.
 */
export function buildSnowflakeFreshnessQuery() {
  return `
SELECT MAX(RUN_DATE) AS last_run_date
FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
`;
}

/**
 * Build query for getting unique owners
 */
export function buildOwnersQuery() {
  return `
SELECT DISTINCT
    OWNER_ACTUAL_NAME__C_OPPT AS owner
FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY
WHERE OWNER_ACTUAL_NAME__C_OPPT IS NOT NULL
  AND SOURCE_SNAPSHOT_DATE = (SELECT MAX(SOURCE_SNAPSHOT_DATE) FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY)

UNION

SELECT DISTINCT
    funnel.OPP_OWNER_NAME AS owner
FROM FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT funnel
WHERE funnel.OPP_OWNER_NAME IS NOT NULL

ORDER BY owner
`;
}

/**
 * Build query for getting available close months
 */
export function buildCloseMonthsQuery() {
  return `
SELECT DISTINCT
    TO_CHAR(dim.CALENDAR_CLOSEDATE, 'YYYY-MM') AS close_month
FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim
WHERE dim.CALENDAR_CLOSEDATE IS NOT NULL
  AND dim.RUN_DATE = (SELECT MAX(RUN_DATE) FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT)
ORDER BY close_month DESC
`;
}

/**
 * Build query for getting opportunity stats
 */
export function buildStatsQuery() {
  return `
SELECT
    COUNT(*) AS total_opportunities,
    COUNT(DISTINCT dim.OPPORTUNITY_STAGE_NAME) AS total_stages,
    COUNT(DISTINCT COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME)) AS total_owners,
    SUM(arr.product_arr_usd) AS total_pipeline_value
FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim
LEFT JOIN (
    SELECT
        CRM_OPPORTUNITY_ID,
        OWNER_ACTUAL_NAME__C_OPPT
    FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY
    WHERE SOURCE_SNAPSHOT_DATE = (SELECT MAX(SOURCE_SNAPSHOT_DATE) FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY CRM_OPPORTUNITY_ID ORDER BY CRM_OPPORTUNITY_ID) = 1
) curated
    ON dim.CRM_OPPORTUNITY_ID = curated.CRM_OPPORTUNITY_ID
LEFT JOIN (
    SELECT
        OPPORTUNITY_ID,
        OPP_OWNER_NAME
    FROM FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT
    QUALIFY ROW_NUMBER() OVER (PARTITION BY OPPORTUNITY_ID ORDER BY SNAPSHOT_DATE DESC) = 1
) funnel
    ON dim.CRM_OPPORTUNITY_ID = funnel.OPPORTUNITY_ID
LEFT JOIN (
    SELECT
        crm_opportunity_id,
        SUM(product_arr_usd) AS product_arr_usd,
        source_snapshot_date
    FROM PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING
    WHERE is_total_booking = 1
    GROUP BY crm_opportunity_id, source_snapshot_date
    QUALIFY ROW_NUMBER() OVER (PARTITION BY crm_opportunity_id ORDER BY source_snapshot_date DESC) = 1
) arr
    ON dim.CRM_OPPORTUNITY_ID = arr.crm_opportunity_id
WHERE dim.RUN_DATE = (SELECT MAX(RUN_DATE) FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT)
`;
}

// Shared SELECT/JOIN block for SC-specific opportunity queries (used by both the
// normal scoped query and the local-dev TEST_OPP_IDS override below)
const SC_OPPORTUNITIES_SELECT = `
SELECT
    -- Core fields from DIM
    dim.CRM_OPPORTUNITY_ID AS id,
    -- dim.OPPORTUNITY_NAME is masked (always NULL) — use the unmasked staging name instead
    stg.NAME AS name,
    acc.NAME AS account,
    dim.OPPORTUNITY_STAGE_NAME AS stage,
    dim.OPPORTUNITY_TYPE AS type,
    -- dim.OPPORTUNITY_TERRITORY_NAME is always empty at the source — resolve territory via the
    -- account's assigned territory ID against the sales roster instead (verified against live data)
    roster.TERRITORY_NAME AS territory,
    dim.CALENDAR_CLOSEDATE AS close_date,
    dim.OPPORTUNITY_CREATED_DATE AS created_date,

    -- Owner: CURATED_OPPORTUNITIES_HISTORY.OWNER_ACTUAL_NAME__C_OPPT is the most reliable source
    -- (confirmed against known-good cases); fall back to funnel metrics when an opp isn't in that table
    COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME) AS owner,

    -- Notes from staging
    stg.RED_FLAGS_C AS sc_notes,
    stg.NEXT_STEP_C AS next_steps,
    stg.MANAGER_NOTES_C AS manager_notes,
    stg.PRODUCT_SPECIALIST_NOTES_C AS product_specialist_notes,

    -- SC Manager Notes: dim.OPPORTUNITY_SC_MANAGER_NOTES is always empty at the source —
    -- the populated column is SC_MANAGER_NOTES_C on the SFDC fields snapshot (verified against live data)
    sfdc_fields.SC_MANAGER_NOTES_C AS sc_manager_notes,

    -- SC info
    dim.OPPORTUNITY_SERVICES_ENGAGED AS sc_engagement_type,
    sc_user.FULL_NAME AS name_of_sc,
    stg.NAME_OF_SC_C AS sc_user_id,

    -- D-Score
    dim.OPPORTUNITY_D_SCORE_LATEST AS d_score,

    -- Most recent Dispassionate Review (D-Score) date, for the "D-Score not
    -- updated in X days" punch-list criterion. NULL when the opp has no review.
    dscore_review.latest_review_date AS latest_dscore_review_date,

    -- Opportunity number
    stg.OPPORTUNITY_NUMBER_C AS opportunity_number,

    -- Amount from PRESENTATION layer
    arr.product_arr_usd AS amount,

    -- Snapshot dates
    dim.SOURCE_SNAPSHOT_DATE AS snapshot_date,
    dim.RUN_DATE

FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim

-- Join staging for SC field
-- Verified against live data: the "current row" sentinel is VALID_TO_TIMESTAMP = '9999-12-31', not NULL
LEFT JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2 stg
    ON dim.CRM_OPPORTUNITY_ID = stg.ID
    AND stg.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'

-- Join for account name
LEFT JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2 acc
    ON stg.ACCOUNT_ID = acc.ID
    AND acc.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'

-- Join for SC name
LEFT JOIN (
    SELECT USER_ID, FULL_NAME, EMAIL
    FROM FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY
    QUALIFY ROW_NUMBER() OVER (PARTITION BY USER_ID ORDER BY USER_ID) = 1
) sc_user
    ON stg.NAME_OF_SC_C = sc_user.USER_ID

-- Join for owner name from curated opportunity history (primary owner source)
LEFT JOIN (
    SELECT
        CRM_OPPORTUNITY_ID,
        OWNER_ACTUAL_NAME__C_OPPT
    FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY
    WHERE SOURCE_SNAPSHOT_DATE = (SELECT MAX(SOURCE_SNAPSHOT_DATE) FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY CRM_OPPORTUNITY_ID ORDER BY CRM_OPPORTUNITY_ID) = 1
) curated
    ON dim.CRM_OPPORTUNITY_ID = curated.CRM_OPPORTUNITY_ID

-- Join for owner name from funnel metrics (fallback for opps not in curated history)
LEFT JOIN (
    SELECT OPPORTUNITY_ID, OPP_OWNER_NAME, SNAPSHOT_DATE
    FROM FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT
    QUALIFY ROW_NUMBER() OVER (PARTITION BY OPPORTUNITY_ID ORDER BY SNAPSHOT_DATE DESC) = 1
) funnel
    ON dim.CRM_OPPORTUNITY_ID = funnel.OPPORTUNITY_ID

-- Join for amount
LEFT JOIN (
    SELECT
        crm_opportunity_id,
        SUM(product_arr_usd) AS product_arr_usd,
        source_snapshot_date
    FROM PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING
    WHERE is_total_booking = 1
    GROUP BY crm_opportunity_id, source_snapshot_date
    QUALIFY ROW_NUMBER() OVER (PARTITION BY crm_opportunity_id ORDER BY source_snapshot_date DESC) = 1
) arr
    ON dim.CRM_OPPORTUNITY_ID = arr.crm_opportunity_id

-- Join for SC Manager Notes (daily snapshot; dedupe to most recent SOURCE_SNAPSHOT_DATE)
LEFT JOIN (
    SELECT
        ID,
        SC_MANAGER_NOTES_C
    FROM FUNCTIONAL.GTM_SALES_OPS.DIM_CRM_OPPORTUNITIES_SFDC_FIELDS_DAILY_SNAPSHOT
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY SOURCE_SNAPSHOT_DATE DESC) = 1
) sfdc_fields
    ON dim.CRM_OPPORTUNITY_ID = sfdc_fields.ID

-- Join for territory name via the account's assigned territory (dedupe roster to one row per territory)
LEFT JOIN (
    SELECT
        TERRITORY_ID,
        TERRITORY_NAME
    FROM FUNCTIONAL.GTM_SALES_OPS.ROSTER
    WHERE TERRITORY_NAME IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY TERRITORY_ID ORDER BY TERRITORY_ID) = 1
) roster
    ON acc.ASSIGNED_TERRITORY_ID_C = roster.TERRITORY_ID

-- Join for most recent Dispassionate Review date per opportunity. Same source
-- and current-version/not-deleted filters as buildDispassionateReviewsQuery,
-- collapsed to one row per opp (the max review timestamp).
LEFT JOIN (
    SELECT
        OPPORTUNITY_C AS opportunity_id,
        MAX(VALID_FROM_TIMESTAMP) AS latest_review_date
    FROM CLEANSED.SALESFORCE.SALESFORCE_DISPASSIONATE_REVIEW_C_SCD2
    WHERE VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
      AND IS_DELETED = FALSE
    GROUP BY OPPORTUNITY_C
) dscore_review
    ON dim.CRM_OPPORTUNITY_ID = dscore_review.opportunity_id
`;

/**
 * Build SQL query for SC-specific opportunities (active pipeline stages 00-08 plus Lost)
 * @param {string | string[]} snowflakeUserIds - USER_ID(s) from USER_HISTORY table. A manager
 *   scoping to their team's SCs (see Sales Engineers setting) passes multiple IDs here.
 * @param {{ arrThreshold?: number, closeDateFrom?: string, closeDateTo?: string }} [scope]
 */
export function buildScOpportunitiesQuery(snowflakeUserIds, scope = {}) {
  // Local dev override: ignore SC identity, stage, and ARR/close-date scoping
  // and pull only the fixed TEST_OPP_IDS set (see services/test-opps.js)
  if (isTestOppsEnabled()) {
    const idList = TEST_OPP_IDS.map(id => `'${id}'`).join(', ');
    return `
${SC_OPPORTUNITIES_SELECT}
WHERE dim.RUN_DATE = (
    SELECT MAX(RUN_DATE)
    FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
)
  AND dim.CRM_OPPORTUNITY_ID IN (${idList})

ORDER BY stg.NAME
`;
  }

  const userIds = Array.isArray(snowflakeUserIds) ? snowflakeUserIds : [snowflakeUserIds];
  const userIdList = userIds.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
  const { arrThreshold, closeDateFrom, closeDateTo } = scope;

  const scopeConditions = [];
  if (arrThreshold !== null && arrThreshold !== undefined && !isNaN(arrThreshold)) {
    scopeConditions.push(`arr.product_arr_usd >= ${arrThreshold}`);
  }
  if (closeDateFrom) {
    const fromEscaped = closeDateFrom.replace(/'/g, "''");
    scopeConditions.push(`dim.CALENDAR_CLOSEDATE >= '${fromEscaped}'`);
  }
  if (closeDateTo) {
    const toEscaped = closeDateTo.replace(/'/g, "''");
    scopeConditions.push(`dim.CALENDAR_CLOSEDATE <= '${toEscaped}'`);
  }
  const scopeSql = scopeConditions.length > 0 ? `\n  AND ${scopeConditions.join('\n  AND ')}` : '';

  return `
${SC_OPPORTUNITIES_SELECT}
WHERE dim.RUN_DATE = (
    SELECT MAX(RUN_DATE)
    FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
)
  -- Filter: Only these SCs' opportunities
  AND stg.NAME_OF_SC_C IN (${userIdList})
  -- Filter: Active pipeline stages 00-08 (08 = "08 - Closed", i.e. Won), plus explicitly-Lost opps
  AND (
    SUBSTRING(dim.OPPORTUNITY_STAGE_NAME, 1, 2) IN ('00', '01', '02', '03', '04', '05', '06', '07', '08')
    OR dim.OPPORTUNITY_STAGE_NAME = 'Lost'
  )${scopeSql}

ORDER BY stg.NAME
`;
}

/**
 * Build query for fetching SE activities (SA_ACTIVITY_DAILY_SNAPSHOT), deduped to
 * one row per activity ID (the source table has one row per SOURCE_SNAPSHOT_DATE)
 * and scoped to a date range and set of CREATED_BY USER_IDs.
 *
 * Scoped by CREATED_BY_ID (who logged the activity), not OWNER_ID (who it's
 * assigned to) - the two can differ (e.g. an admin logging an activity on an
 * SE's behalf), and "SE activity logged" should reflect who did the logging.
 *
 * Incremental mode (range.since set): only activities that FIRST appeared in a
 * snapshot on/after `since` are returned. SA_ACTIVITY_DAILY_SNAPSHOT re-stamps
 * every active activity with a fresh SOURCE_SNAPSHOT_DATE daily (one ID can have
 * 900+ snapshot dates), so SOURCE_SNAPSHOT_DATE alone can't tell "new" from
 * "still around" - first-appearance (MIN over the ID) is the only reliable
 * new-record signal. ACTIVITY_DATE is unusable as a watermark too: activities
 * are routinely backdated and future-dated. Rows are already deduped to the
 * latest version per ID, so re-pulling an overlap window is upsert-idempotent.
 * @param {string[]} createdByIds - Snowflake USER_ID(s) of the SE(s) to scope to
 * @param {{ fromDate: string, toDate: string, since?: string }} range - ISO dates
 *   bounding ACTIVITY_DATE; `since` (ISO date/timestamp) switches to incremental mode.
 */
export function buildActivitiesQuery(createdByIds, range = {}) {
  const ids = Array.isArray(createdByIds) ? createdByIds : [createdByIds];
  const createdByIdList = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
  const { fromDate, toDate, since } = range;
  const fromEscaped = fromDate.replace(/'/g, "''");
  const toEscaped = toDate.replace(/'/g, "''");

  // Incremental: keep only IDs whose earliest snapshot is on/after `since`.
  // MIN() OVER is safe alongside the ACTIVITY_DATE filter because ACTIVITY_DATE
  // is constant per ID, so the WHERE keeps/drops each ID's rows as a whole.
  const firstSeenQualify = since
    ? `\n  AND MIN(SOURCE_SNAPSHOT_DATE) OVER (PARTITION BY ID) >= '${since.replace(/'/g, "''")}'`
    : '';

  return `
SELECT
    ID AS id,
    ACCOUNTID AS account_id,
    ACCOUNT_NAME AS account_name,
    ACTIVITY_DATE AS activity_date,
    ACTIVITY_MONTH AS activity_month,
    ACTIVITY_YEAR_QUARTER AS activity_year_quarter,
    ACTIVITY_YEAR_MONTH AS activity_year_month,
    SUBJECT AS subject,
    TYPE AS type,
    SUB_TYPE AS sub_type,
    DURATION_OF_HOURS AS duration_hours,
    OWNER_ID AS owner_id,
    OWNER_NAME_CLEAN AS owner_name,
    OWNER_ROLE AS owner_role,
    CREATED_BY_ID AS created_by_id,
    CREATED_BY_NAME AS created_by_name,
    WHATID AS whatid,
    WHATID_TYPE AS whatid_type,
    ACTIVITY_MATCH_OPP_NAME AS activity_match_opp_name,
    ACTIVITY_MATCH_ACCOUNT_NAME AS activity_match_account_name,
    IS_SALES_ACTIVITY AS is_sales_activity,
    SOURCE_SNAPSHOT_DATE AS source_snapshot_date
FROM FUNCTIONAL.GTM_SALES_OPS.SA_ACTIVITY_DAILY_SNAPSHOT
WHERE CREATED_BY_ID IN (${createdByIdList})
  AND ACTIVITY_DATE BETWEEN '${fromEscaped}' AND '${toEscaped}'
QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY SOURCE_SNAPSHOT_DATE DESC) = 1${firstSeenQualify}
`;
}

/**
 * Build query for fetching Dispassionate Review (D-Score) records for a set of
 * opportunities. Each opportunity can have MULTIPLE review records over time
 * (one per D-Score review event), so this returns one row per review, not per opp.
 *
 * Source: CLEANSED.SALESFORCE.SALESFORCE_DISPASSIONATE_REVIEW_C_SCD2 (a view over
 * the Salesforce Dispassionate_Review__c custom object). Column names below were
 * confirmed via DESCRIBE VIEW + live probes on 2026-07-22, not from documentation.
 *
 * Notable data facts verified against opp 006PC00000VkYRRYA3 (5 review records):
 *   - ID is the Salesforce record id (18-char), unique per review — used as PK.
 *   - OPPORTUNITY_C is the FK to the opportunity, in the 18-char CRM_OPPORTUNITY_ID
 *     form (matches dim.CRM_OPPORTUNITY_ID), so no id normalization is needed.
 *   - CREATED_DATE / LAST_MODIFIED_DATE / SYSTEM_MODSTAMP are NULL at the source
 *     (masked/unsynced); VALID_FROM_TIMESTAMP is the usable per-review timestamp,
 *     and NAME embeds the review date (e.g. "... D-Score 2026-05-26").
 *   - The individual score dimensions are categorical VARCHAR fields whose leading
 *     digit is the sub-score (e.g. "2 - 71% to 85%; ...").
 *   - VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000' marks the current SCD2 version;
 *     we filter to it so edit-history versions of the same review don't double-count.
 * Incremental mode (`since` set): only reviews whose current version became
 * valid on/after `since` are returned. VALID_FROM_TIMESTAMP advances whenever a
 * review is created OR edited (a new SCD2 version), so this catches both new
 * reviews and edits; the ON CONFLICT (id) upsert dedups against what's cached.
 * @param {string | string[]} opportunityIds - CRM opportunity id(s) (18-char form)
 * @param {{ since?: string }} [opts] - `since` (ISO timestamp) switches to incremental mode
 */
export function buildDispassionateReviewsQuery(opportunityIds, opts = {}) {
  const ids = Array.isArray(opportunityIds) ? opportunityIds : [opportunityIds];
  const idList = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
  const { since } = opts;
  const sinceClause = since
    ? `\n  AND VALID_FROM_TIMESTAMP >= '${since.replace(/'/g, "''")}'`
    : '';

  return `
SELECT
    ID AS id,
    OPPORTUNITY_C AS opportunity_id,
    NAME AS name,
    IS_DELETED AS is_deleted,
    CREATED_BY_ID AS created_by_id,
    LAST_MODIFIED_BY_ID AS last_modified_by_id,
    LAST_ACTIVITY_DATE AS last_activity_date,

    -- Categorical score dimensions (leading digit is the sub-score)
    HAVE_WE_COMPLETED_APPROPRIATE_DISCOVERY_C AS discovery_score,
    LEVEL_OF_FUNCTIONAL_FIT_TO_REQUIREMENTS_C AS solution_fit_score,
    HAVE_WE_ARCHITECTED_THE_FULL_SOLUTION_C AS architecture_score,
    COMPLEXITY_OF_INTEGRATION_REQUIREMENTS_C AS integration_score,
    ENGAGEMENT_OF_CUSTOMER_SECURITY_TEAM_C AS security_score,
    BUSINESS_CASE_ROI_ANALYSIS_COMPLETED_C AS net_value_score,
    COMPETITIVENESS_AGAINST_TECH_FUNCT_REQ_S_C AS competitiveness_score,
    HOW_MANY_TECH_ALLIANCE_PARTNERS_NEEDED_C AS partner_score,
    HOW_WELL_ENGAGED_ALIGNED_ARE_WE_TO_IT_C AS it_alignment_score,
    KEY_GOALS_FOR_CUST_S_EXEC_STAKEHOLDERS_C AS exec_goals_score,
    STAGE_OF_SERVICES_SCOPING_C AS services_score,
    STATUS_OF_ADVANCED_CUSTOM_DEMO_C AS advanced_demo_score,
    TYPE_OF_HANDS_ON_ACCESS_BEING_PROVIDED_C AS testing_access_score,

    -- Free-text notes per score dimension
    DISCOVERY_SCORE_NOTES_C AS discovery_score_notes,
    SOLUTION_FIT_SCORE_NOTES_C AS solution_fit_score_notes,
    ARCHITECTURE_SCORE_NOTES_C AS architecture_score_notes,
    INTEGRATION_SCORE_NOTES_C AS integration_score_notes,
    SECURITY_SCORE_NOTES_C AS security_score_notes,
    NET_VALUE_SCORE_NOTES_C AS net_value_score_notes,
    OTHER_COMPETITORS_SCORE_NOTES_C AS other_competitors_score_notes,
    PARTNER_SCORE_NOTES_C AS partner_score_notes,
    IT_ALIGNMENT_SCORE_NOTES_C AS it_alignment_score_notes,
    EXEC_GOALS_SCORE_NOTES_C AS exec_goals_score_notes,
    SERVICES_SCORE_NOTES_C AS services_score_notes,
    ADVANCED_DEMO_SCORE_NOTES_C AS advanced_demo_score_notes,
    TESTING_ACCESS_SCORE_NOTES_C AS testing_access_score_notes,

    -- SCD2 versioning timestamps (VALID_FROM is the usable per-review timestamp)
    VALID_FROM_TIMESTAMP AS valid_from_timestamp,
    VALID_TO_TIMESTAMP AS valid_to_timestamp
FROM CLEANSED.SALESFORCE.SALESFORCE_DISPASSIONATE_REVIEW_C_SCD2
WHERE OPPORTUNITY_C IN (${idList})
  -- Current SCD2 version only (avoid double-counting edit-history versions)
  AND VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
  AND IS_DELETED = FALSE${sinceClause}
ORDER BY OPPORTUNITY_C, VALID_FROM_TIMESTAMP
`;
}
