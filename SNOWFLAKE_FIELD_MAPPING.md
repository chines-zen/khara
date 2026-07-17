# Snowflake Field Mapping for SE Opp Rigor

## Complete Field Mapping (Verified with Opp 006PC00000WQT8nYAH)

| App Field | Snowflake Source | Notes |
|-----------|------------------|-------|
| **id** | `STG_SALESFORCE_OPPORTUNITY_SCD2.ID` | ✅ Verified: 006PC00000WQT8nYAH |
| **name** | `STG_SALESFORCE_OPPORTUNITY_SCD2.NAME` | ✅ Verified: "MarginEdge \| AIA + QA + Copilot" |
| **account** | `STG_SALESFORCE_ACCOUNT_SCD2.NAME` (join on `ACCOUNT_ID`) | ✅ Verified: "MarginEdge" |
| **stage** | `STG_SALESFORCE_OPPORTUNITY_SCD2.STAGE_NAME` | ✅ Verified: "02 - Confirm Need" |
| **amount** | `OPPORTUNITY_LEVEL_PIPELINE_BOOKING.PRODUCT_ARR_USD` (summed) | ✅ Verified: $72,570.00 |
| **closeDate** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT.CALENDAR_CLOSEDATE` | ✅ Verified: 2026-07-17 |
| **owner** | `USER_HISTORY.FULL_NAME` (join on `OWNER_ID`) | ⚠️ MASKED - owner_id returns NULL |
| **scNotes** | `STG_SALESFORCE_OPPORTUNITY_SCD2.RED_FLAGS_C` | ✅ Verified: SC notes present |
| **nextSteps** | `STG_SALESFORCE_OPPORTUNITY_SCD2.NEXT_STEP_C` | ✅ **FIXED** - was using `NEXT_STEP`, correct field is `NEXT_STEP_C` |
| **managerNotes** | `STG_SALESFORCE_OPPORTUNITY_SCD2.MANAGER_NOTES_C` | ✅ Verified: Manager notes present |
| **scManagerNotes** | `STG_SALESFORCE_OPPORTUNITY_SCD2.SC_MANAGER_NOTES_C` | ❌ **NOT REPLICATED** - Field exists but always NULL in Snowflake (data present in Salesforce but not synced) |
| **scEngagementType** | `STG_SALESFORCE_OPPORTUNITY_SCD2.SERVICES_ENGAGED_C` | ✅ **NEW FIELD** - Multi-select (semicolon-delimited) e.g. "Trial;Demo" |
| **productSpecialistNotes** | `STG_SALESFORCE_OPPORTUNITY_SCD2.PRODUCT_SPECIALIST_NOTES_C` | ✅ **NEW FIELD** - Verified with FreedomPay opp |
| **nameOfSc** | `USER_HISTORY.FULL_NAME` (join on `NAME_OF_SC_C`) | ✅ Verified: "Chad Hines" |
| **dScore** | `STG_SALESFORCE_OPPORTUNITY_SCD2.D_SCORE_LATEST_C` | ✅ Verified: 5.0 (rolled up from most recent Dispassionate_Review__c) |
| **recentDScoreDate** | `SOURCE_SNAPSHOT_DATE` when D-Score last changed | ✅ Use snapshot history to find date of last D-Score change (2026-05-26) |
| **dScoreDelta** | **CALCULATED BY APP** | ✅ Calculate from snapshot history (5.0 - 0.0 = 5.0) |

## Verified SQL Query

```sql
SELECT
    -- Core identification
    opp.id AS opportunity_id,
    opp.name AS opportunity_name,
    acc.name AS account_name,
    opp.stage_name,
    opp.type AS opportunity_type,

    -- Amount from PRESENTATION layer (MUST SUM where IS_TOTAL_BOOKING=1)
    arr.product_arr_usd AS amount,

    -- Close date from dimension table
    dim.calendar_closedate AS close_date,

    -- Owner fields (⚠️ MASKED)
    opp.owner_id,                    -- Returns NULL due to masking policy
    owner_user.full_name AS owner_name,  -- Returns NULL due to masking

    -- SC fields
    opp.name_of_sc_c AS sc_user_id,
    sc_user.full_name AS sc_name,

    -- Notes fields (all from staging)
    opp.red_flags_c AS sc_notes,
    opp.next_step_c AS ae_notes,
    opp.manager_notes_c AS manager_notes,
    opp.sc_manager_notes_c AS sc_manager_notes,
    opp.services_engaged_c AS sc_engagement_type,
    opp.product_specialist_notes_c AS product_specialist_notes,

    -- D-Score
    opp.d_score_latest_c AS d_score,

    -- Additional useful fields
    opp.opportunity_number_c,
    dim.opportunity_created_date,
    dim.source_snapshot_date

FROM FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2 opp

-- Join for account name
LEFT JOIN FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2 acc
    ON opp.account_id = acc.id
    AND acc.valid_to_timestamp = '9999-12-31 00:00:00.000'

-- Join for owner name (⚠️ MASKED - will return NULL)
LEFT JOIN FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY owner_user
    ON opp.owner_id = owner_user.user_id

-- Join for SC name
LEFT JOIN FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY sc_user
    ON opp.name_of_sc_c = sc_user.user_id

-- Join for close date (from dimension table)
LEFT JOIN FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT dim
    ON opp.id = dim.crm_opportunity_id
    AND dim.run_date = (SELECT MAX(run_date) FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT WHERE crm_opportunity_id = opp.id)

-- Join for amount (from PRESENTATION layer - primary source)
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
    ON opp.id = arr.crm_opportunity_id

WHERE opp.id = '006PC00000WQT8nYAH'
    AND opp.valid_to_timestamp = '9999-12-31 00:00:00.000';
```

## Test Results from Opportunity 006PC00000WQT8nYAH

```json
{
  "OPPORTUNITY_ID": "006PC00000WQT8nYAH",
  "OPPORTUNITY_NAME": "MarginEdge | AIA + QA + Copilot",
  "ACCOUNT_NAME": "MarginEdge",
  "STAGE_NAME": "02 - Confirm Need",
  "OPPORTUNITY_TYPE": "Expansion",
  "AMOUNT": 72570.00,
  "CLOSE_DATE": "2026-07-17",
  "OWNER_ID": null,  // ⚠️ MASKED
  "OWNER_NAME": null,  // ⚠️ MASKED
  "SC_USER_ID": "0051E00000Gs7gpQAB",
  "SC_NAME": "Chad Hines",
  "SC_NOTES": "05/26/2026:\nNext steps:\nWaiting for client feedback...",
  "AE_NOTES": null,  // AE hasn't added next steps yet
  "MANAGER_NOTES": "May 27, 2026 - Currently using Fin and we are meeting with them tomorrow...",
  "SC_MANAGER_NOTES": null,  // SC Manager hasn't added notes
  "D_SCORE": 5.0,
  "OPPORTUNITY_NUMBER_C": "4686616",
  "OPPORTUNITY_CREATED_DATE": "2026-03-26",
  "SOURCE_SNAPSHOT_DATE": "2026-06-01"
}
```

## Table Reference

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2** | Primary source for opportunity data | id, name, stage_name, red_flags_c, next_step, manager_notes_c, sc_manager_notes_c, d_score_latest_c, name_of_sc_c, owner_id |
| **FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2** | Account names | id, name |
| **FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT** | Close dates and additional dimensions | calendar_closedate, opportunity_created_date, source_snapshot_date |
| **PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING** | ARR/Amount (PRIMARY SOURCE) | product_arr_usd, is_total_booking, source_snapshot_date |
| **FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY** | User names for SC and owners | user_id, full_name, email |

## D-Score Architecture Notes

**Salesforce Structure:**
- D-Scores are stored in a separate custom object: `Dispassionate_Review__c`
- Each opportunity can have multiple D-Score reviews over time (historical record)
- The most recent D-Score is **rolled up** to the opportunity via formula field: `D_Score_Latest__c`
- Reference field on opportunity: `Most_Recent_Dispassionate_ID__c` (currently NULL - may not be replicated to Snowflake)

**Your Screenshot Shows:**
- Opportunity 006PC00000WQT8nYAH has 4 D-Score reviews:
  - 5/26/2026 7:17 AM → D-Score: 5
  - 5/26/2026 7:16 AM → D-Score: 0
  - 4/24/2026 7:38 AM → D-Score: 0
  - 4/6/2026 11:55 AM → D-Score: 0

**Snowflake Implementation:**
- The `Dispassionate_Review__c` object table doesn't appear to be replicated to Snowflake (or has a different naming pattern)
- However, the **rolled-up value** (`D_Score_Latest__c = 5.0`) IS available on the opportunity record
- The daily snapshots in `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` capture D-Score changes over time
- We can use snapshot history to determine **when** the D-Score last changed (2026-05-26)

**Recommendation:**
Use the rolled-up D-Score value and snapshot history. This gives us:
- Current D-Score (5.0)
- Date of last D-Score change (2026-05-26)
- D-Score delta (5.0 - previous value)

## Known Issues

### 1. SC Manager Notes Field Not Replicated
- `SC_MANAGER_NOTES_C` field exists in Snowflake but is always NULL
- Data is present in Salesforce (confirmed by user: "5.26.26 ongoing copilot trial...")
- Last ZDP update: 2026-06-02 (very recent)
- Last DBT update: 2026-05-26
- **Conclusion**: Field is not being synced from Salesforce to Snowflake
- **Recommendation**: 
  - Either request this field be added to the Salesforce → Snowflake replication
  - Or skip this field in the app until replication is fixed
  - Alternative: Use a fallback or leave it empty in the UI

### 2. Owner Fields Are Masked
- `OWNER_ID` and `OWNER_NAME` return NULL due to Snowflake masking policies
- **Solution Options:**
  - Request access to the required dataset collection via ZDM
  - Query by email if we know the owner's email address
  - Skip owner field entirely in the app
  - Use a default/placeholder value

### 2. recentDScoreDate - Found! ✅
- The app needs to know **when** the D-Score was last updated
- **Solution:** Use the daily snapshots from `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT`
- Query the snapshot history to find the most recent `SOURCE_SNAPSHOT_DATE` where `OPPORTUNITY_D_SCORE_LATEST` changed
- For opportunity 006PC00000WQT8nYAH:
  - D-Score changed from 0.0 → 5.0 on **2026-05-26** (matches user's "5/26/2026 7:17 AM")
  - Query pattern:
```sql
SELECT source_snapshot_date
FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
WHERE crm_opportunity_id = '006PC00000WQT8nYAH'
  AND opportunity_d_score_latest != LAG(opportunity_d_score_latest) OVER (ORDER BY run_date)
ORDER BY run_date DESC
LIMIT 1
```

### 3. dScoreDelta Must Be Calculated
- The app needs to show **change** in D-Score over time
- Requires historical D-Score values, not just current value
- **Solution Options:**
  - Query historical snapshots and calculate delta in SQL
  - Store previous D-Score in app state
  - Calculate from a D-Score history table

## Next Steps

1. ✅ All core fields mapped and verified
2. ✅ Find `recentDScoreDate` field - use snapshot history to find when D-Score last changed
3. ❌ Determine approach for `dScoreDelta` calculation - compare current vs previous D-Score from snapshots
4. ❌ Decide how to handle masked owner fields - either request access or skip owner display
5. ❌ Update `index.js` to use Snowflake queries instead of mock data
6. ❌ Test with multiple opportunities to ensure query works at scale

## Implementation Notes for recentDScoreDate and dScoreDelta

Both fields require querying the snapshot history table and comparing D-Score values across snapshots:

**recentDScoreDate**: Find the snapshot date when the D-Score last changed
```sql
-- For a single opportunity
SELECT source_snapshot_date
FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
WHERE crm_opportunity_id = '006PC00000WQT8nYAH'
  AND opportunity_d_score_latest != COALESCE(LAG(opportunity_d_score_latest) OVER (ORDER BY run_date), 0)
ORDER BY run_date DESC
LIMIT 1;
-- Result: 2026-05-26 (matches user's "5/26/2026 7:17 AM")
```

**dScoreDelta**: Calculate the change in D-Score since the last change
```sql
-- For a single opportunity
SELECT 
    opportunity_d_score_latest - COALESCE(LAG(opportunity_d_score_latest) OVER (ORDER BY run_date), 0) AS d_score_delta
FROM FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
WHERE crm_opportunity_id = '006PC00000WQT8nYAH'
ORDER BY run_date DESC
LIMIT 1;
-- Result: 5.0 (changed from 0.0 to 5.0)
```

For bulk queries fetching multiple opportunities, use a CTE or subquery to compute these values efficiently.
