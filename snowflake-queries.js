/**
 * Build SQL query for fetching opportunities with all required fields
 */
export function buildOpportunitiesQuery(filters = {}) {
  const {
    search,
    stages,
    owner,
    closeMonths,
    daysSinceMax,
    arrMin,
    opportunityIds,
    scUserId,
    closeDateFrom,
    closeDateTo,
  } = filters;

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
    const idList = opportunityIds.map((id) => `'${id}'`).join(", ");
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
    const stageList = stages
      .map((s) => `'${s.replace(/'/g, "''")}'`)
      .join(", ");
    conditions.push(`dim.OPPORTUNITY_STAGE_NAME IN (${stageList})`);
  }

  // Owner filter
  if (owner) {
    const ownerEscaped = owner.replace(/'/g, "''");
    conditions.push(
      `COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME) = '${ownerEscaped}'`,
    );
  }

  // SC identity filter (scope to opportunities where this Snowflake user is the assigned SC)
  if (scUserId) {
    const scUserIdEscaped = scUserId.replace(/'/g, "''");
    conditions.push(`stg.NAME_OF_SC_C = '${scUserIdEscaped}'`);
  }

  // Close month filter
  if (closeMonths && closeMonths.length > 0) {
    const monthList = closeMonths.map((m) => `'${m}'`).join(", ");
    conditions.push(
      `TO_CHAR(dim.CALENDAR_CLOSEDATE, 'YYYY-MM') IN (${monthList})`,
    );
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
  if (
    daysSinceMax !== null &&
    daysSinceMax !== undefined &&
    !isNaN(daysSinceMax)
  ) {
    conditions.push(
      `DATEDIFF('day', dim.SOURCE_SNAPSHOT_DATE, CURRENT_DATE()) <= ${daysSinceMax}`,
    );
  }

  // ARR Minimum filter
  if (arrMin !== null && arrMin !== undefined && !isNaN(arrMin)) {
    conditions.push(`arr.product_arr_usd >= ${arrMin}`);
  }

  // Add all conditions to WHERE clause
  if (conditions.length > 0) {
    sql += `\n  AND ${conditions.join("\n  AND ")}`;
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

// Shared SELECT/JOIN block for SC-specific opportunity queries
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
  const userIds = Array.isArray(snowflakeUserIds)
    ? snowflakeUserIds
    : [snowflakeUserIds];
  const userIdList = userIds
    .map((id) => `'${id.replace(/'/g, "''")}'`)
    .join(", ");
  const { arrThreshold, closeDateFrom, closeDateTo } = scope;

  const scopeConditions = [];
  if (
    arrThreshold !== null &&
    arrThreshold !== undefined &&
    !isNaN(arrThreshold)
  ) {
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
  const scopeSql =
    scopeConditions.length > 0
      ? `\n  AND ${scopeConditions.join("\n  AND ")}`
      : "";

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
 * Build an equivalent, targeted version of buildScOpportunitiesQuery.
 *
 * This is intentionally not wired into the request path yet. It exists for
 * side-by-side result and performance testing against buildScOpportunitiesQuery.
 *
 * The production query's final WHERE clause scopes opportunities after several
 * independent "latest row per opportunity" subqueries have been declared. This
 * version first builds the SC/stage/date target set, then makes every expensive
 * source join depend on those target IDs. That gives Snowflake a much smaller
 * input for the window functions and aggregation while preserving the returned
 * columns and filtering semantics.
 *
 * @param {string | string[]} snowflakeUserIds - USER_ID(s) from USER_HISTORY.
 * @param {{ arrThreshold?: number, closeDateFrom?: string, closeDateTo?: string }} [scope]
 */
// Retained only as a query-plan comparison point. Its repeated CTE references
// can be expanded by the optimizer, so the benchmark uses the three-step
// literal-target implementation below instead.
export function buildScOpportunitiesCtePrototypeQuery(
  snowflakeUserIds,
  scope = {},
) {
  const userIds = Array.isArray(snowflakeUserIds)
    ? snowflakeUserIds
    : [snowflakeUserIds];
  const userIdList = userIds
    .map((id) => `'${id.replace(/'/g, "''")}'`)
    .join(", ");
  const { arrThreshold, closeDateFrom, closeDateTo } = scope;

  const baseScopeConditions = [
    `stg.NAME_OF_SC_C IN (${userIdList})`,
    `(
      SUBSTRING(dim.OPPORTUNITY_STAGE_NAME, 1, 2) IN ('00', '01', '02', '03', '04', '05', '06', '07', '08')
      OR dim.OPPORTUNITY_STAGE_NAME = 'Lost'
    )`,
  ];

  if (closeDateFrom) {
    baseScopeConditions.push(
      `dim.CALENDAR_CLOSEDATE >= '${closeDateFrom.replace(/'/g, "''")}'`,
    );
  }
  if (closeDateTo) {
    baseScopeConditions.push(
      `dim.CALENDAR_CLOSEDATE <= '${closeDateTo.replace(/'/g, "''")}'`,
    );
  }

  // In the production query an ARR threshold on a LEFT JOINed table is
  // semantically an inner filter. Keep that behavior, but apply it after ARR
  // has been calculated only for the already-scoped base opportunities.
  const arrThresholdClause =
    arrThreshold !== null && arrThreshold !== undefined && !isNaN(arrThreshold)
      ? `\n    WHERE arr.product_arr_usd >= ${arrThreshold}`
      : "";

  return `
WITH scoped_base AS (
    SELECT
        dim.CRM_OPPORTUNITY_ID AS opportunity_id,
        dim.OPPORTUNITY_STAGE_NAME AS stage,
        dim.OPPORTUNITY_TYPE AS type,
        dim.CALENDAR_CLOSEDATE AS close_date,
        dim.OPPORTUNITY_CREATED_DATE AS created_date,
        dim.OPPORTUNITY_SERVICES_ENGAGED AS sc_engagement_type,
        dim.OPPORTUNITY_D_SCORE_LATEST AS d_score,
        dim.SOURCE_SNAPSHOT_DATE AS snapshot_date,
        dim.RUN_DATE AS run_date,
        stg.NAME AS name,
        stg.ACCOUNT_ID AS account_id,
        stg.RED_FLAGS_C AS sc_notes,
        stg.NEXT_STEP_C AS next_steps,
        stg.MANAGER_NOTES_C AS manager_notes,
        stg.PRODUCT_SPECIALIST_NOTES_C AS product_specialist_notes,
        stg.NAME_OF_SC_C AS sc_user_id,
        stg.OPPORTUNITY_NUMBER_C AS opportunity_number
    FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim
    -- The legacy query LEFT JOINs this table, but its final NAME_OF_SC_C filter
    -- makes that join inner in practice. Making it explicit lets the target set
    -- be formed before the expensive enrichments below.
    JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2 stg
      ON dim.CRM_OPPORTUNITY_ID = stg.ID
     AND stg.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
    WHERE dim.RUN_DATE = (
        SELECT MAX(RUN_DATE)
        FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
    )
      AND ${baseScopeConditions.join("\n      AND ")}
),

target_arr AS (
    SELECT
        booking.crm_opportunity_id,
        SUM(booking.product_arr_usd) AS product_arr_usd,
        booking.source_snapshot_date
    FROM PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING booking
    JOIN (SELECT DISTINCT opportunity_id FROM scoped_base) target
      ON target.opportunity_id = booking.crm_opportunity_id
    WHERE booking.is_total_booking = 1
    GROUP BY booking.crm_opportunity_id, booking.source_snapshot_date
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY booking.crm_opportunity_id
        ORDER BY booking.source_snapshot_date DESC
    ) = 1
),

target_opportunities AS (
    SELECT
        base.*,
        arr.product_arr_usd AS amount
    FROM scoped_base base
    LEFT JOIN target_arr arr
      ON base.opportunity_id = arr.crm_opportunity_id${arrThresholdClause}
),

target_accounts AS (
    SELECT
        acc.ID,
        acc.NAME,
        acc.ASSIGNED_TERRITORY_ID_C
    FROM FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2 acc
    JOIN (
        SELECT DISTINCT account_id
        FROM target_opportunities
        WHERE account_id IS NOT NULL
    ) target
      ON target.account_id = acc.ID
    WHERE acc.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
),

target_sc_users AS (
    SELECT USER_ID, FULL_NAME
    FROM FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY
    WHERE USER_ID IN (
        SELECT DISTINCT sc_user_id
        FROM target_opportunities
        WHERE sc_user_id IS NOT NULL
    )
    QUALIFY ROW_NUMBER() OVER (PARTITION BY USER_ID ORDER BY USER_ID) = 1
),

current_curated_snapshot AS (
    SELECT MAX(SOURCE_SNAPSHOT_DATE) AS source_snapshot_date
    FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY
),

target_curated AS (
    SELECT
        curated.CRM_OPPORTUNITY_ID,
        curated.OWNER_ACTUAL_NAME__C_OPPT
    FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY curated
    JOIN (SELECT DISTINCT opportunity_id FROM target_opportunities) target
      ON target.opportunity_id = curated.CRM_OPPORTUNITY_ID
    WHERE curated.SOURCE_SNAPSHOT_DATE = (
        SELECT source_snapshot_date FROM current_curated_snapshot
    )
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY curated.CRM_OPPORTUNITY_ID
        ORDER BY curated.CRM_OPPORTUNITY_ID
    ) = 1
),

target_funnel AS (
    SELECT
        funnel.OPPORTUNITY_ID,
        funnel.OPP_OWNER_NAME,
        funnel.SNAPSHOT_DATE
    FROM FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT funnel
    JOIN (SELECT DISTINCT opportunity_id FROM target_opportunities) target
      ON target.opportunity_id = funnel.OPPORTUNITY_ID
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY funnel.OPPORTUNITY_ID
        ORDER BY funnel.SNAPSHOT_DATE DESC
    ) = 1
),

target_sfdc_fields AS (
    SELECT
        fields.ID,
        fields.SC_MANAGER_NOTES_C
    FROM FUNCTIONAL.GTM_SALES_OPS.DIM_CRM_OPPORTUNITIES_SFDC_FIELDS_DAILY_SNAPSHOT fields
    JOIN (SELECT DISTINCT opportunity_id FROM target_opportunities) target
      ON target.opportunity_id = fields.ID
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY fields.ID
        ORDER BY fields.SOURCE_SNAPSHOT_DATE DESC
    ) = 1
),

target_roster AS (
    SELECT
        roster.TERRITORY_ID,
        roster.TERRITORY_NAME
    FROM FUNCTIONAL.GTM_SALES_OPS.ROSTER roster
    JOIN (
        SELECT DISTINCT acc.ASSIGNED_TERRITORY_ID_C AS territory_id
        FROM target_accounts acc
        WHERE acc.ASSIGNED_TERRITORY_ID_C IS NOT NULL
    ) target
      ON target.territory_id = roster.TERRITORY_ID
    WHERE roster.TERRITORY_NAME IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY roster.TERRITORY_ID
        ORDER BY roster.TERRITORY_ID
    ) = 1
),

target_dscore_reviews AS (
    SELECT
        review.OPPORTUNITY_C AS opportunity_id,
        MAX(review.VALID_FROM_TIMESTAMP) AS latest_review_date
    FROM CLEANSED.SALESFORCE.SALESFORCE_DISPASSIONATE_REVIEW_C_SCD2 review
    JOIN (SELECT DISTINCT opportunity_id FROM target_opportunities) target
      ON target.opportunity_id = review.OPPORTUNITY_C
    WHERE review.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
      AND review.IS_DELETED = FALSE
    GROUP BY review.OPPORTUNITY_C
)

SELECT
    target.opportunity_id AS id,
    target.name AS name,
    acc.NAME AS account,
    target.stage AS stage,
    target.type AS type,
    roster.TERRITORY_NAME AS territory,
    target.close_date AS close_date,
    target.created_date AS created_date,
    COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME) AS owner,
    target.sc_notes AS sc_notes,
    target.next_steps AS next_steps,
    target.manager_notes AS manager_notes,
    target.product_specialist_notes AS product_specialist_notes,
    fields.SC_MANAGER_NOTES_C AS sc_manager_notes,
    target.sc_engagement_type AS sc_engagement_type,
    sc_user.FULL_NAME AS name_of_sc,
    target.sc_user_id AS sc_user_id,
    target.d_score AS d_score,
    review.latest_review_date AS latest_dscore_review_date,
    target.opportunity_number AS opportunity_number,
    target.amount AS amount,
    target.snapshot_date AS snapshot_date,
    target.run_date AS run_date
FROM target_opportunities target
LEFT JOIN target_accounts acc
  ON target.account_id = acc.ID
LEFT JOIN target_sc_users sc_user
  ON target.sc_user_id = sc_user.USER_ID
LEFT JOIN target_curated curated
  ON target.opportunity_id = curated.CRM_OPPORTUNITY_ID
LEFT JOIN target_funnel funnel
  ON target.opportunity_id = funnel.OPPORTUNITY_ID
LEFT JOIN target_sfdc_fields fields
  ON target.opportunity_id = fields.ID
LEFT JOIN target_roster roster
  ON acc.ASSIGNED_TERRITORY_ID_C = roster.TERRITORY_ID
LEFT JOIN target_dscore_reviews review
  ON target.opportunity_id = review.opportunity_id
ORDER BY target.name
`;
}

function toSqlStringList(values) {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

/**
 * Step 1 of the targeted experiment: get only the IDs that match the app's SC,
 * stage, and close-date scope. It deliberately does not join enrichment data.
 */
export function buildScOpportunityBaseTargetQuery(
  snowflakeUserIds,
  scope = {},
) {
  const userIds = Array.isArray(snowflakeUserIds)
    ? snowflakeUserIds
    : [snowflakeUserIds];
  const { closeDateFrom, closeDateTo } = scope;
  const conditions = [
    `stg.NAME_OF_SC_C IN (${toSqlStringList(userIds)})`,
    `(
      SUBSTRING(dim.OPPORTUNITY_STAGE_NAME, 1, 2) IN ('00', '01', '02', '03', '04', '05', '06', '07', '08')
      OR dim.OPPORTUNITY_STAGE_NAME = 'Lost'
    )`,
  ];

  if (closeDateFrom) {
    conditions.push(
      `dim.CALENDAR_CLOSEDATE >= '${closeDateFrom.replace(/'/g, "''")}'`,
    );
  }
  if (closeDateTo) {
    conditions.push(
      `dim.CALENDAR_CLOSEDATE <= '${closeDateTo.replace(/'/g, "''")}'`,
    );
  }

  return `
SELECT
    dim.CRM_OPPORTUNITY_ID AS opportunity_id,
    stg.NAME_OF_SC_C AS sc_user_id
FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim
JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2 stg
  ON dim.CRM_OPPORTUNITY_ID = stg.ID
 AND stg.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
WHERE dim.RUN_DATE = (
    SELECT MAX(RUN_DATE)
    FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
)
  AND ${conditions.join("\n  AND ")}
`;
}

/**
 * Step 2 of the targeted experiment: calculate latest ARR only for the IDs
 * returned by buildScOpportunityBaseTargetQuery.
 */
export function buildScOpportunityTargetAmountsQuery(opportunityIds) {
  if (opportunityIds.length === 0) {
    return `SELECT NULL::VARCHAR AS opportunity_id, NULL::NUMBER AS amount WHERE FALSE`;
  }

  return `
SELECT
    booking.crm_opportunity_id AS opportunity_id,
    SUM(booking.product_arr_usd) AS amount,
    booking.source_snapshot_date
FROM PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING booking
WHERE booking.is_total_booking = 1
  AND booking.crm_opportunity_id IN (${toSqlStringList(opportunityIds)})
GROUP BY booking.crm_opportunity_id, booking.source_snapshot_date
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY booking.crm_opportunity_id
    ORDER BY booking.source_snapshot_date DESC
) = 1
`;
}

/**
 * Step 3 of the targeted experiment: enrich an already-filtered target set.
 * Passing target IDs as VALUES prevents Snowflake from repeatedly expanding a
 * complex base CTE in every enrichment subquery.
 *
 * @param {{ id: string, amount: number | null, scUserId: string | null }[]} targets
 */
export function buildScOpportunitiesTargetedQuery(targets) {
  if (targets.length === 0) {
    return `SELECT NULL::VARCHAR AS id WHERE FALSE`;
  }

  const targetValues = targets
    .map((target) => {
      const id = target.id.replace(/'/g, "''");
      const scUserId = target.scUserId?.replace(/'/g, "''") ?? null;
      const amount = Number(target.amount);
      return `('${id}', ${Number.isFinite(amount) ? amount : "NULL"}, ${scUserId ? `'${scUserId}'` : "NULL"})`;
    })
    .join(",\n        ");

  return `
WITH target_opportunities AS (
    SELECT
        COLUMN1::VARCHAR AS opportunity_id,
        -- NUMBER without an explicit scale defaults to scale 0 and would round
        -- fractional ARR values as the literal target set is reconstructed.
        COLUMN2::NUMBER(38, 9) AS amount,
        COLUMN3::VARCHAR AS sc_user_id
    FROM VALUES
        ${targetValues}
),
target_sc_users AS (
    SELECT user_history.USER_ID, user_history.FULL_NAME
    FROM FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY user_history
    JOIN (
        SELECT DISTINCT sc_user_id
        FROM target_opportunities
        WHERE sc_user_id IS NOT NULL
    ) target
      ON target.sc_user_id = user_history.USER_ID
    QUALIFY ROW_NUMBER() OVER (PARTITION BY user_history.USER_ID ORDER BY user_history.USER_ID) = 1
),
current_curated_snapshot AS (
    SELECT MAX(SOURCE_SNAPSHOT_DATE) AS source_snapshot_date
    FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY
),
target_curated AS (
    SELECT curated.CRM_OPPORTUNITY_ID, curated.OWNER_ACTUAL_NAME__C_OPPT
    FROM FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY curated
    JOIN target_opportunities target
      ON target.opportunity_id = curated.CRM_OPPORTUNITY_ID
    WHERE curated.SOURCE_SNAPSHOT_DATE = (
        SELECT source_snapshot_date FROM current_curated_snapshot
    )
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY curated.CRM_OPPORTUNITY_ID
        ORDER BY curated.CRM_OPPORTUNITY_ID
    ) = 1
),
target_funnel AS (
    SELECT funnel.OPPORTUNITY_ID, funnel.OPP_OWNER_NAME, funnel.SNAPSHOT_DATE
    FROM FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT funnel
    JOIN target_opportunities target
      ON target.opportunity_id = funnel.OPPORTUNITY_ID
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY funnel.OPPORTUNITY_ID
        ORDER BY funnel.SNAPSHOT_DATE DESC
    ) = 1
),
target_sfdc_fields AS (
    SELECT fields.ID, fields.SC_MANAGER_NOTES_C
    FROM FUNCTIONAL.GTM_SALES_OPS.DIM_CRM_OPPORTUNITIES_SFDC_FIELDS_DAILY_SNAPSHOT fields
    JOIN target_opportunities target
      ON target.opportunity_id = fields.ID
    -- The source is a full daily snapshot. For the active target IDs, using
    -- its global newest snapshot avoids a costly per-ID window scan. The
    -- benchmark checks this remains equivalent to the legacy query's
    -- per-ID latest-row result before this flow is considered for production.
    WHERE fields.SOURCE_SNAPSHOT_DATE = (
        SELECT MAX(SOURCE_SNAPSHOT_DATE)
        FROM FUNCTIONAL.GTM_SALES_OPS.DIM_CRM_OPPORTUNITIES_SFDC_FIELDS_DAILY_SNAPSHOT
    )
),
target_dscore_reviews AS (
    SELECT
        review.OPPORTUNITY_C AS opportunity_id,
        MAX(review.VALID_FROM_TIMESTAMP) AS latest_review_date
    FROM CLEANSED.SALESFORCE.SALESFORCE_DISPASSIONATE_REVIEW_C_SCD2 review
    JOIN target_opportunities target
      ON target.opportunity_id = review.OPPORTUNITY_C
    WHERE review.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
      AND review.IS_DELETED = FALSE
    GROUP BY review.OPPORTUNITY_C
),
target_roster AS (
    SELECT roster.TERRITORY_ID, roster.TERRITORY_NAME
    FROM FUNCTIONAL.GTM_SALES_OPS.ROSTER roster
    WHERE roster.TERRITORY_NAME IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY roster.TERRITORY_ID
        ORDER BY roster.TERRITORY_ID
    ) = 1
)
SELECT
    dim.CRM_OPPORTUNITY_ID AS id,
    stg.NAME AS name,
    acc.NAME AS account,
    dim.OPPORTUNITY_STAGE_NAME AS stage,
    dim.OPPORTUNITY_TYPE AS type,
    roster.TERRITORY_NAME AS territory,
    dim.CALENDAR_CLOSEDATE AS close_date,
    dim.OPPORTUNITY_CREATED_DATE AS created_date,
    COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME) AS owner,
    stg.RED_FLAGS_C AS sc_notes,
    stg.NEXT_STEP_C AS next_steps,
    stg.MANAGER_NOTES_C AS manager_notes,
    stg.PRODUCT_SPECIALIST_NOTES_C AS product_specialist_notes,
    fields.SC_MANAGER_NOTES_C AS sc_manager_notes,
    dim.OPPORTUNITY_SERVICES_ENGAGED AS sc_engagement_type,
    sc_user.FULL_NAME AS name_of_sc,
    stg.NAME_OF_SC_C AS sc_user_id,
    dim.OPPORTUNITY_D_SCORE_LATEST AS d_score,
    review.latest_review_date AS latest_dscore_review_date,
    stg.OPPORTUNITY_NUMBER_C AS opportunity_number,
    target.amount AS amount,
    dim.SOURCE_SNAPSHOT_DATE AS snapshot_date,
    dim.RUN_DATE
FROM target_opportunities target
JOIN FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim
  ON target.opportunity_id = dim.CRM_OPPORTUNITY_ID
JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2 stg
  ON dim.CRM_OPPORTUNITY_ID = stg.ID
 AND stg.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
LEFT JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2 acc
  ON stg.ACCOUNT_ID = acc.ID
 AND acc.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
LEFT JOIN target_sc_users sc_user
  ON stg.NAME_OF_SC_C = sc_user.USER_ID
LEFT JOIN target_curated curated
  ON dim.CRM_OPPORTUNITY_ID = curated.CRM_OPPORTUNITY_ID
LEFT JOIN target_funnel funnel
  ON dim.CRM_OPPORTUNITY_ID = funnel.OPPORTUNITY_ID
LEFT JOIN target_sfdc_fields fields
  ON dim.CRM_OPPORTUNITY_ID = fields.ID
LEFT JOIN target_roster roster
  ON acc.ASSIGNED_TERRITORY_ID_C = roster.TERRITORY_ID
LEFT JOIN target_dscore_reviews review
  ON dim.CRM_OPPORTUNITY_ID = review.opportunity_id
WHERE dim.RUN_DATE = (
    SELECT MAX(RUN_DATE)
    FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
)
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
  const createdByIdList = ids
    .map((id) => `'${id.replace(/'/g, "''")}'`)
    .join(", ");
  const { fromDate, toDate, since } = range;
  const fromEscaped = fromDate.replace(/'/g, "''");
  const toEscaped = toDate.replace(/'/g, "''");

  // Incremental: keep only IDs whose earliest snapshot is on/after `since`.
  // MIN() OVER is safe alongside the ACTIVITY_DATE filter because ACTIVITY_DATE
  // is constant per ID, so the WHERE keeps/drops each ID's rows as a whole.
  const firstSeenQualify = since
    ? `\n  AND MIN(SOURCE_SNAPSHOT_DATE) OVER (PARTITION BY ID) >= '${since.replace(/'/g, "''")}'`
    : "";

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
 * Experiment-only first step for the latest-snapshot target. Keeping this
 * separate makes the latest date explicit to the data query and removes the
 * legacy query's per-activity history window.
 */
export function buildActivitiesLatestSnapshotDateQuery() {
  return `
SELECT MAX(SOURCE_SNAPSHOT_DATE) AS source_snapshot_date
FROM FUNCTIONAL.GTM_SALES_OPS.SA_ACTIVITY_DAILY_SNAPSHOT
`;
}

/**
 * Targeted Activities query for a resolved, literal snapshot date.
 * The literal date returns the current source row directly, avoiding the
 * legacy per-activity history window. When duplicate source rows exist for a
 * single activity in that current snapshot, prefer the row whose matching
 * opportunity name exists in the current Salesforce opportunity dimension.
 * This prevents a stale historical opportunity name from winning arbitrarily.
 *
 * @param {string[]} createdByIds - Snowflake USER_ID(s) of the SE(s) to scope to
 * @param {{ fromDate: string, toDate: string, sourceSnapshotDate: string }} range
 */
export function buildActivitiesSnapshotDateTargetQuery(
  createdByIds,
  range = {},
) {
  const ids = Array.isArray(createdByIds) ? createdByIds : [createdByIds];
  const createdByIdList = ids
    .map((id) => `'${id.replace(/'/g, "''")}'`)
    .join(", ");
  const { fromDate, toDate, sourceSnapshotDate } = range;
  if (!sourceSnapshotDate) {
    throw new Error(
      "sourceSnapshotDate is required for the Activities target query",
    );
  }

  const fromEscaped = fromDate.replace(/'/g, "''");
  const toEscaped = toDate.replace(/'/g, "''");
  const snapshotEscaped = sourceSnapshotDate.replace(/'/g, "''");

  return `
WITH current_opportunity_names AS (
    SELECT ID, NAME
    FROM FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2
    WHERE VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'
),
current_snapshot AS (
SELECT
    activity.ID AS id,
    activity.ACCOUNTID AS account_id,
    activity.ACCOUNT_NAME AS account_name,
    activity.ACTIVITY_DATE AS activity_date,
    activity.ACTIVITY_MONTH AS activity_month,
    activity.ACTIVITY_YEAR_QUARTER AS activity_year_quarter,
    activity.ACTIVITY_YEAR_MONTH AS activity_year_month,
    activity.SUBJECT AS subject,
    activity.TYPE AS type,
    activity.SUB_TYPE AS sub_type,
    activity.DURATION_OF_HOURS AS duration_hours,
    activity.OWNER_ID AS owner_id,
    activity.OWNER_NAME_CLEAN AS owner_name,
    activity.OWNER_ROLE AS owner_role,
    activity.CREATED_BY_ID AS created_by_id,
    activity.CREATED_BY_NAME AS created_by_name,
    activity.WHATID AS whatid,
    activity.WHATID_TYPE AS whatid_type,
    COALESCE(opp.NAME, activity.ACTIVITY_MATCH_OPP_NAME) AS activity_match_opp_name,
    activity.ACTIVITY_MATCH_ACCOUNT_NAME AS activity_match_account_name,
    activity.IS_SALES_ACTIVITY AS is_sales_activity,
    activity.SOURCE_SNAPSHOT_DATE AS source_snapshot_date
FROM FUNCTIONAL.GTM_SALES_OPS.SA_ACTIVITY_DAILY_SNAPSHOT activity
LEFT JOIN current_opportunity_names opp
  ON LOWER(TRIM(activity.ACTIVITY_MATCH_OPP_NAME)) = LOWER(TRIM(opp.NAME))
WHERE activity.SOURCE_SNAPSHOT_DATE = '${snapshotEscaped}'
  AND activity.CREATED_BY_ID IN (${createdByIdList})
  AND activity.ACTIVITY_DATE BETWEEN '${fromEscaped}' AND '${toEscaped}'
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY activity.ID
    ORDER BY IFF(opp.ID IS NULL, 1, 0), activity.ACTIVITY_MATCH_OPP_NAME
) = 1
)
SELECT
    id,
    account_id,
    account_name,
    activity_date,
    activity_month,
    activity_year_quarter,
    activity_year_month,
    subject,
    type,
    sub_type,
    duration_hours,
    owner_id,
    owner_name,
    owner_role,
    created_by_id,
    created_by_name,
    whatid,
    whatid_type,
    activity_match_opp_name,
    activity_match_account_name,
    is_sales_activity,
    source_snapshot_date
FROM current_snapshot
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
  const idList = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  const { since } = opts;
  const sinceClause = since
    ? `\n  AND VALID_FROM_TIMESTAMP >= '${since.replace(/'/g, "''")}'`
    : "";

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

/**
 * Build the compact Gong spotlight query used by the local call mirror.
 * The corpus is the authoritative opportunity/call link; the unified events
 * table supplies the spotlight fields and Gong call id.
 */
export function buildGongCallsQuery(opportunityIds) {
  const ids = Array.isArray(opportunityIds) ? opportunityIds : [opportunityIds];
  const idList = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");

  return `
SELECT
    c.OPP_ID AS opportunity_id,
    c.CONVERSATION_KEY AS conversation_key,
    COALESCE(TO_VARCHAR(u.CALL_ID), '') AS call_id,
    c.CALL_DATE::date AS call_date,
    COALESCE(u.TITLE, c.CALL_TITLE) AS title,
    CASE WHEN u.CONVERSATION_KEY IS NULL
      THEN 'Details not yet ingested in Snowflake.'
      ELSE u.CALL_SPOTLIGHT_BRIEF
    END AS brief,
    CASE WHEN u.CONVERSATION_KEY IS NULL
      THEN 'Details not yet ingested in Snowflake.'
      ELSE u.CALL_SPOTLIGHT_NEXT_STEPS
    END AS next_steps,
    u.CALL_SPOTLIGHT_KEY_POINTS AS key_points,
    COALESCE((
      SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
        'name', p.NAME,
        'affiliation', LOWER(COALESCE(p.AFFILIATION, 'unclassified'))
      ))
      FROM CLEANSED.GONG.GONG_CONVERSATION_PARTICIPANTS_SCD1 p
      WHERE p.CONVERSATION_KEY = c.CONVERSATION_KEY
        AND COALESCE(p.IS_DELETED, FALSE) = FALSE
        AND p.TYPE IN ('attendee', 'invitee', 'organizer', 'required', 'optional')
        AND LOWER(COALESCE(p.TYPE, '')) NOT IN ('invited', 'invitee')
        AND p.NAME IS NOT NULL
    ), ARRAY_CONSTRUCT()) AS attendees,
    CASE WHEN u.CALL_ID IS NULL THEN ''
      ELSE 'https://us-17476.app.gong.io/call?id=' || TO_VARCHAR(u.CALL_ID)
    END AS gong_url
FROM FUNCTIONAL.COMPANY_INTELLIGENCE.CI_GONG_CALL_CORPUS c
LEFT JOIN FUNCTIONAL.CONVERGE.UNIFIED_GONG_EVENTS u
  ON u.CONVERSATION_KEY = c.CONVERSATION_KEY
WHERE c.OPP_ID IN (${idList})
  AND c.CALL_DATE >= DATEADD(day, -30, CURRENT_DATE)
  AND c.CALL_DATE <= CURRENT_DATE
ORDER BY c.OPP_ID, c.CALL_DATE DESC
`;
}
