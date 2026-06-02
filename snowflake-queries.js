/**
 * Build SQL query for fetching opportunities with all required fields
 */
export function buildOpportunitiesQuery(filters = {}) {
  const { search, stages, owner, closeMonths, daysSinceMax, arrMin, opportunityIds } = filters;

  // Base query with all fields from DIM and staging
  let sql = `
SELECT
    -- Core fields from DIM
    dim.CRM_OPPORTUNITY_ID AS id,
    dim.OPPORTUNITY_NAME AS name,
    acc.NAME AS account,
    dim.OPPORTUNITY_STAGE_NAME AS stage,
    dim.OPPORTUNITY_TYPE AS type,
    dim.OPPORTUNITY_TERRITORY_NAME AS territory,
    dim.CALENDAR_CLOSEDATE AS close_date,
    dim.OPPORTUNITY_CREATED_DATE AS created_date,

    -- Owner from funnel metrics (may be NULL if not in that table)
    funnel.OPP_OWNER_NAME AS owner,

    -- Notes from staging (not in DIM)
    stg.RED_FLAGS_C AS sc_notes,
    stg.NEXT_STEP_C AS next_steps,
    stg.MANAGER_NOTES_C AS manager_notes,
    stg.PRODUCT_SPECIALIST_NOTES_C AS product_specialist_notes,

    -- SC Manager Notes from DIM
    dim.OPPORTUNITY_SC_MANAGER_NOTES AS sc_manager_notes,

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

-- Join for owner name from funnel metrics
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
      LOWER(dim.OPPORTUNITY_NAME) LIKE LOWER('%${searchTerm}%')
      OR LOWER(acc.NAME) LIKE LOWER('%${searchTerm}%')
      OR LOWER(funnel.OPP_OWNER_NAME) LIKE LOWER('%${searchTerm}%')
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
    conditions.push(`funnel.OPP_OWNER_NAME = '${ownerEscaped}'`);
  }

  // Close month filter
  if (closeMonths && closeMonths.length > 0) {
    const monthList = closeMonths.map(m => `'${m}'`).join(', ');
    conditions.push(`TO_CHAR(dim.CALENDAR_CLOSEDATE, 'YYYY-MM') IN (${monthList})`);
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

  sql += `\nORDER BY dim.OPPORTUNITY_NAME`;

  return sql;
}

/**
 * Build query for getting unique owners
 */
export function buildOwnersQuery() {
  return `
SELECT DISTINCT
    funnel.OPP_OWNER_NAME AS owner
FROM FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT funnel
WHERE funnel.OPP_OWNER_NAME IS NOT NULL
ORDER BY funnel.OPP_OWNER_NAME
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
    COUNT(DISTINCT funnel.OPP_OWNER_NAME) AS total_owners,
    SUM(arr.product_arr_usd) AS total_pipeline_value
FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim
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
        SUM(product_arr_usd) AS product_arr_usd
    FROM PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING
    WHERE is_total_booking = 1
    GROUP BY crm_opportunity_id
    QUALIFY ROW_NUMBER() OVER (PARTITION BY crm_opportunity_id ORDER BY source_snapshot_date DESC) = 1
) arr
    ON dim.CRM_OPPORTUNITY_ID = arr.crm_opportunity_id
WHERE dim.RUN_DATE = (SELECT MAX(RUN_DATE) FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT)
`;
}

/**
 * Build SQL query for SC-specific opportunities (stages 00-07 only)
 * @param {string} snowflakeUserId - USER_ID from USER_HISTORY table
 */
export function buildScOpportunitiesQuery(snowflakeUserId) {
  const userIdEscaped = snowflakeUserId.replace(/'/g, "''");

  return `
SELECT
    -- Core fields from DIM
    dim.CRM_OPPORTUNITY_ID AS id,
    dim.OPPORTUNITY_NAME AS name,
    acc.NAME AS account,
    dim.OPPORTUNITY_STAGE_NAME AS stage,
    dim.OPPORTUNITY_TYPE AS type,
    dim.OPPORTUNITY_TERRITORY_NAME AS territory,
    dim.CALENDAR_CLOSEDATE AS close_date,
    dim.OPPORTUNITY_CREATED_DATE AS created_date,

    -- Owner from funnel metrics
    funnel.OPP_OWNER_NAME AS owner,

    -- Notes from staging
    stg.RED_FLAGS_C AS sc_notes,
    stg.NEXT_STEP_C AS next_steps,
    stg.MANAGER_NOTES_C AS manager_notes,
    stg.PRODUCT_SPECIALIST_NOTES_C AS product_specialist_notes,

    -- SC Manager Notes from DIM
    dim.OPPORTUNITY_SC_MANAGER_NOTES AS sc_manager_notes,

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

-- Join for owner name
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

WHERE dim.RUN_DATE = (
    SELECT MAX(RUN_DATE)
    FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
)
  -- Filter: Only this SC's opportunities
  AND stg.NAME_OF_SC_C = '${userIdEscaped}'
  -- Filter: Stages 00-07 only
  AND SUBSTRING(dim.OPPORTUNITY_STAGE_NAME, 1, 2) IN ('00', '01', '02', '03', '04', '05', '06', '07')

ORDER BY dim.OPPORTUNITY_NAME
`;
}
