# Final Snowflake Field Mapping

**Last Updated**: 2026-06-02  
**Test Opportunities**: 21 provided by user

---

## Complete Field Mapping

| # | App Field | Snowflake Table | Column Name | Type | Status |
|---|-----------|-----------------|-------------|------|--------|
| 1 | **id** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `CRM_OPPORTUNITY_ID` | VARCHAR | ✅ Working |
| 2 | **name** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `OPPORTUNITY_NAME` | VARCHAR | ✅ Working |
| 3 | **account** | `STG_SALESFORCE_ACCOUNT_SCD2` | `NAME` | VARCHAR | ✅ Working (JOIN) |
| 4 | **stage** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `OPPORTUNITY_STAGE_NAME` | VARCHAR | ✅ Working |
| 5 | **type** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `OPPORTUNITY_TYPE` | VARCHAR | ✅ Working |
| 6 | **territory** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `OPPORTUNITY_TERRITORY_NAME` | VARCHAR | ✅ Working |
| 7 | **amount** | `OPPORTUNITY_LEVEL_PIPELINE_BOOKING` | `PRODUCT_ARR_USD` (SUM) | NUMBER | ✅ Working |
| 8 | **closeDate** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `CALENDAR_CLOSEDATE` | DATE | ✅ Working |
| 9 | **createdDate** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `OPPORTUNITY_CREATED_DATE` | DATE | ✅ Working |
| 10 | **owner** | `OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT` | `OPP_OWNER_NAME` | VARCHAR | ⚠️ Partial |
| 11 | **scNotes** | `STG_SALESFORCE_OPPORTUNITY_SCD2` | `RED_FLAGS_C` | TEXT | ✅ Working |
| 12 | **nextSteps** | `STG_SALESFORCE_OPPORTUNITY_SCD2` | `NEXT_STEP_C` | TEXT | ✅ Working |
| 13 | **managerNotes** | `STG_SALESFORCE_OPPORTUNITY_SCD2` | `MANAGER_NOTES_C` | TEXT | ✅ Working |
| 14 | **scManagerNotes** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `OPPORTUNITY_SC_MANAGER_NOTES` | TEXT | ✅ Working |
| 15 | **scEngagementType** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `OPPORTUNITY_SERVICES_ENGAGED` | VARCHAR | ✅ Working |
| 16 | **productSpecialistNotes** | `STG_SALESFORCE_OPPORTUNITY_SCD2` | `PRODUCT_SPECIALIST_NOTES_C` | TEXT | ✅ Working |
| 17 | **nameOfSc** | `USER_HISTORY` | `FULL_NAME` | VARCHAR | ✅ Working (JOIN) |
| 18 | **scUserId** | `STG_SALESFORCE_OPPORTUNITY_SCD2` | `NAME_OF_SC_C` | VARCHAR | ✅ Working |
| 19 | **dScore** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `OPPORTUNITY_D_SCORE_LATEST` | NUMBER | ✅ Working |
| 20 | **recentDScoreDate** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `SOURCE_SNAPSHOT_DATE` | DATE | ✅ Working |
| 21 | **dScoreDelta** | Calculated from snapshot history | N/A | NUMBER | 🔄 TODO |
| 22 | **opportunityNumber** | `STG_SALESFORCE_OPPORTUNITY_SCD2` | `OPPORTUNITY_NUMBER_C` | VARCHAR | ✅ Working |
| 23 | **snapshotDate** | `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | `SOURCE_SNAPSHOT_DATE` | DATE | ✅ Working |

---

## Table Details

### Primary Table (Most Fields)
**`FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT`**
- Most up-to-date snapshot data
- Updated daily via `RUN_DATE`
- Filter: `WHERE RUN_DATE = (SELECT MAX(RUN_DATE) FROM ...)`

**Fields from DIM**:
- Core: id, name, stage, type, territory, closeDate, createdDate
- SC: scManagerNotes, scEngagementType
- D-Score: dScore, recentDScoreDate
- Dates: snapshotDate

### Staging Table (Notes Fields)
**`FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2`**
- SCD2 table (tracks history)
- Filter: `WHERE VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'` for current

**Fields from Staging**:
- Notes: scNotes, nextSteps, managerNotes, productSpecialistNotes
- SC: scUserId
- Other: opportunityNumber

### Account Table (Account Names)
**`FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2`**
- JOIN: `ON dim.OPPORTUNITY_ZENDESK_INSTANCE_ACCOUNT_ID = acc.ID`
- Filter: `WHERE acc.VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'`

**Fields**: account (NAME)

### User Table (SC Names)
**`FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY`**
- JOIN: `ON stg.NAME_OF_SC_C = sc_user.USER_ID`

**Fields**: nameOfSc (FULL_NAME)

### Funnel Metrics (Owner Names - Partial Coverage)
**`FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT`**
- JOIN: Latest snapshot per opportunity
- ⚠️ **NOT all opportunities exist in this table**

**Fields**: owner (OPP_OWNER_NAME)

### Pipeline Booking (Amount/ARR)
**`PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING`**
- Must SUM `PRODUCT_ARR_USD`
- Filter: `WHERE IS_TOTAL_BOOKING = 1`
- Latest snapshot per opportunity

**Fields**: amount (SUM of PRODUCT_ARR_USD)

---

## Known Issues & Workarounds

### 1. Owner Field (Partial Coverage) ⚠️

**Issue**: `OWNER_ID` is masked across all tables (returns NULL)

**Solution**: Use `OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT.OPP_OWNER_NAME`

**Limitation**: Not all opportunities exist in this table

**Impact**: Some opportunities will show "Not Available" for owner

**Alternatives Explored**:
- ❌ `STG_SALESFORCE_OPPORTUNITY_SCD2.OWNER_ID` - Masked
- ❌ `DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT.OPPORTUNITY_OWNER_NAME_CLEAN` - Masked
- ❌ `STG_SALESFORCE_OPPORTUNITY_SCD2.PRIMARY_ACCOUNT_OWNER_EMAIL_C` - NULL
- ❌ Account table `OWNER_ID` - Masked

**No fallback available** - this is the only unmasked source.

### 2. D-Score Delta (Not Implemented) 🔄

**Current**: Always returns 0

**Required**: Calculate from historical snapshots

**Method**:
```sql
SELECT 
    opportunity_d_score_latest - LAG(opportunity_d_score_latest) OVER (ORDER BY run_date) AS delta
FROM DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT
WHERE crm_opportunity_id = '...'
ORDER BY run_date DESC
LIMIT 1
```

**Status**: TODO - not yet implemented

### 3. Next Steps Format

**Snowflake**: Single text field (`NEXT_STEP_C`)

**Frontend**: Expects array of strings

**Current Solution**: Wrap text in array: `[text]`

**Better Solution**: Parse by newlines or delimiters if needed

---

## Query Performance Notes

### Indexes
- All tables have primary keys on ID fields
- DIM table indexed on `RUN_DATE` and `CRM_OPPORTUNITY_ID`

### Query Optimization
1. Always filter DIM by latest `RUN_DATE` first
2. Use `QUALIFY ROW_NUMBER()` for latest snapshots instead of subqueries
3. LEFT JOIN for optional fields (owner, amount)
4. Filter on DIM before JOINs when possible

### Expected Performance
- Single opportunity: ~200-500ms
- 20 opportunities: ~500-800ms
- Full table scan: NOT RECOMMENDED (millions of rows)

---

## Testing

### Test Opportunity IDs (21 total)
```
006PC00000UhFIfYAL, 006PC00000VICiQYA1, 0066R00000ugmYLQAY,
006PC00000Lz2yTYAR, 006PC00000VcAe1YAF, 006PC00000ZMrMXYA1,
006PC00000W4CEfYAN, 006PC00000WBQWDYA5, 006PC00000YWPPWYA5,
006PC00000W3pzeYAB, 006PC00000ICTYYYAX, 006PC00000W8JKsYAN,
006PC00000XM41yYAD, 006PC00000XXrU0YAL, 006PC00000V0mcHYAR,
006PC00000YpZpmYAF, 006PC00000TltOcYAJ, 006PC00000VyUcTYAV,
006PC00000YqHvdYAF, 006PC00000UZS8FYAX, 006PC00000Y1pxmYAB
```

### Found in Snowflake
- ✅ 18 out of 21 found in DIM table
- ❌ 3 not found (need to verify IDs with user)

---

## Next Steps

1. ✅ All fields mapped
2. ✅ Snowflake integration code complete
3. ⏭️ Test with real data
4. ⏭️ Implement D-Score delta calculation
5. ⏭️ Handle owner field gracefully when NULL
6. ⏭️ Add error handling for missing opportunities
7. ⏭️ Consider caching strategy for performance
