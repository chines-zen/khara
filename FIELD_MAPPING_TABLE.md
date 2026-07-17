# Complete Field Mapping Table

**Test Opportunity**: 006PC00000PCk3tYAD (FreedomPay Co-pilot)

| App Field Name | Snowflake Column | Snowflake Table | Status | Example Value from Test Opp |
|----------------|------------------|-----------------|--------|----------------------------|
| **id** | `ID` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `006PC00000PCk3tYAD` |
| **name** | `NAME` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `FreedomPay (Co-pilot)` |
| **account** | `NAME` | `STG_SALESFORCE_ACCOUNT_SCD2` (JOIN on `ACCOUNT_ID`) | ✅ Working | `FreedomPay` |
| **stage** | `STAGE_NAME` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `Lost` |
| **type** | `TYPE` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `Expansion` |
| **amount** | `PRODUCT_ARR_USD` (SUM) | `OPPORTUNITY_LEVEL_PIPELINE_BOOKING` (WHERE `IS_TOTAL_BOOKING=1`) | ✅ Working | `$93,779.52` |
| **closeDate** | `CALENDAR_CLOSEDATE` | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | ✅ Working | `2026-05-26` |
| **createdDate** | `OPPORTUNITY_CREATED_DATE` | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | ✅ Working | `2025-09-29` |
| **owner** | `FULL_NAME` | `USER_HISTORY` (JOIN on `OWNER_ID`) | ⚠️ Masked | `NULL` (masked by policy) |
| **ownerId** | `OWNER_ID` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ⚠️ Masked | `NULL` (masked by policy) |
| **scNotes** | `RED_FLAGS_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `"Next steps (please specify...` (long text starting with 05/26/2026) |
| **nextSteps** (AE Notes) | `NEXT_STEP_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ **FIXED** | `"5/26/26 Meeting booked to add Copilot into renewal at $490k TCV..."` |
| **managerNotes** | `MANAGER_NOTES_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `"5/14 RH: Internal teams responded back..."` |
| **scManagerNotes** | `SC_MANAGER_NOTES_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ❌ **NOT SYNCED** | `NULL` (exists in SF but not replicated to Snowflake) |
| **scEngagementType** | `SERVICES_ENGAGED_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ **NEW** | `"Trial;Demo"` (semicolon-delimited multi-select) |
| **productSpecialistNotes** | `PRODUCT_SPECIALIST_NOTES_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ **NEW** | `"05.25.2026 - WH:\n- What happened last week..."` |
| **nameOfSc** | `FULL_NAME` | `USER_HISTORY` (JOIN on `NAME_OF_SC_C`) | ✅ Working | `Chad Hines` |
| **scUserId** | `NAME_OF_SC_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `0051E00000Gs7gpQAB` |
| **dScore** | `D_SCORE_LATEST_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `23.0` |
| **recentDScoreDate** | `SOURCE_SNAPSHOT_DATE` (when D-Score changed) | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` (calculated from history) | ✅ Working | Calculate from snapshot where D-Score changed |
| **dScoreDelta** | Calculated | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` (current - previous) | ✅ Working | Calculate: current D-Score - previous D-Score |
| **opportunityNumber** | `OPPORTUNITY_NUMBER_C` | `STG_SALESFORCE_OPPORTUNITY_SCD2` | ✅ Working | `4567408` |
| **snapshotDate** | `SOURCE_SNAPSHOT_DATE` | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | ✅ Working | `2026-06-01` |

---

## Table Reference

### Primary Tables Used:

1. **`FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2`**
   - Most opportunity fields (id, name, stage, notes, D-Score, etc.)
   - SCD2 table: Use `WHERE valid_to_timestamp = '9999-12-31 00:00:00.000'` for current records

2. **`FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2`**
   - Account names
   - JOIN on `ACCOUNT_ID`
   - SCD2 table: Use `WHERE valid_to_timestamp = '9999-12-31 00:00:00.000'`

3. **`PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING`**
   - **Primary source for Amount/ARR**
   - Must SUM `PRODUCT_ARR_USD` WHERE `IS_TOTAL_BOOKING = 1`
   - Group by `CRM_OPPORTUNITY_ID` and use latest `SOURCE_SNAPSHOT_DATE`

4. **`FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT`**
   - Close dates, created dates, snapshot dates
   - D-Score history (for calculating recentDScoreDate and dScoreDelta)
   - Use latest `RUN_DATE` for current values

5. **`FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY`**
   - User names (SC, owner)
   - JOIN on `USER_ID` field (e.g., `NAME_OF_SC_C`, `OWNER_ID`)
   - Note: `OWNER_ID` is masked

---

## Key Issues

### ❌ SC Manager Notes Not Synced
- Field `SC_MANAGER_NOTES_C` exists in Snowflake schema
- Always returns NULL even though data exists in Salesforce
- Last Snowflake update: 2026-06-02 (recent, but still NULL)
- **Action needed**: Request field be added to Salesforce → Snowflake replication

### ⚠️ Owner Fields Masked
- `OWNER_ID` returns NULL due to masking policy
- Cannot get owner names via `USER_HISTORY` JOIN
- **Workaround options**:
  1. Request access to required dataset collection via ZDM
  2. Skip owner field in app
  3. Use placeholder value

### ✅ New Fields Added
- `SERVICES_ENGAGED_C` - SC Engagement Type (multi-select)
- `PRODUCT_SPECIALIST_NOTES_C` - Product Specialist Notes

---

## Query Pattern for Amount Field

The amount field requires special handling:

```sql
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
```

This ensures:
- Only product-level ARR records are included (`IS_TOTAL_BOOKING = 1`)
- ARR is summed per opportunity
- Latest snapshot is used
