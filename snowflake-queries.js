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
`;

/**
 * Build SQL query for SC-specific opportunities (active pipeline stages 00-08 plus Lost)
 * @param {string} snowflakeUserId - USER_ID from USER_HISTORY table
 * @param {{ arrThreshold?: number, closeDateFrom?: string, closeDateTo?: string }} [scope]
 */
export function buildScOpportunitiesQuery(snowflakeUserId, scope = {}) {
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

  const userIdEscaped = snowflakeUserId.replace(/'/g, "''");
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
  -- Filter: Only this SC's opportunities
  AND stg.NAME_OF_SC_C = '${userIdEscaped}'
  -- Filter: Active pipeline stages 00-08 (08 = "08 - Closed", i.e. Won), plus explicitly-Lost opps
  AND (
    SUBSTRING(dim.OPPORTUNITY_STAGE_NAME, 1, 2) IN ('00', '01', '02', '03', '04', '05', '06', '07', '08')
    OR dim.OPPORTUNITY_STAGE_NAME = 'Lost'
  )${scopeSql}

ORDER BY stg.NAME
`;
}
