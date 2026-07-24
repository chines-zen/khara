# Snowflake Data Model & Integration Guide

This document describes the Snowflake tables and fields the KHARA app reads
across its three data domains — **Opportunities**, **Dispassionate Reviews
(D-Score)**, and **Activities** — and the patterns we learned building on top of
Zendesk's `ZENDESK-GLOBAL` warehouse. It's written to be shared: if you're
building your own app on this data, the tables, join keys, and gotchas below
should save you the multi-day discovery it took to find them.

Everything here was verified against live data (via `DESCRIBE VIEW` + probes),
not copied from documentation. Column names in these tables are frequently
counterintuitive, and several "obvious" columns are masked or empty at the
source — so **always confirm against the live table before trusting a name**.

> The canonical source of truth for this app is [`snowflake-queries.js`](snowflake-queries.js)
> (the SQL builders) and the `services/*-cache.js` modules (the sync logic).
> If this doc and the code ever disagree, the code wins.

---

## 0. Connection & auth

The app connects with the `snowflake-sdk` and supports two auth modes
(see [`snowflake-connection.js`](snowflake-connection.js)):

| Mode | When | How |
|------|------|-----|
| `EXTERNALBROWSER` (SSO) | Default / production | Each user authenticates as themselves; a browser window opens on first query. Data is scoped by the user's own RBAC **and** by a `WHERE` clause built from their identity. |
| `SNOWFLAKE` (user/pass) | Service account | Set `SNOWFLAKE_USERNAME` + `SNOWFLAKE_PASSWORD`. One shared connection. |

Connections are cached per-identity so each user's SSO session is reused rather
than re-prompting. Config comes from `SNOWFLAKE_ACCOUNT/WAREHOUSE/DATABASE/SCHEMA/ROLE`.

Warehouse used: `PUBLIC_ZENDESK_XS`. Account: `zendesk-global`.

### Masking is real — a NULL may not mean "empty"

Zendesk applies column-level masking policies. A masked column returns `NULL`
for users who lack the required dataset-collection role — which looks identical
to a genuinely empty field. Several columns we initially reached for were masked
or empty at the source and had to be replaced with an unmasked equivalent
(documented per-domain below). If a column that "should" have data comes back
all-NULL, suspect masking before concluding the data is missing.

---

## 1. Opportunities

The opportunity record is assembled from **one base table plus seven joins** —
no single table has everything, and the "obvious" columns on the base table are
often masked or empty. See `buildScOpportunitiesQuery` /
`buildOpportunitiesQuery` in [`snowflake-queries.js`](snowflake-queries.js).

### Base table

`FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` (alias `dim`)

- One row per opportunity per `RUN_DATE` (daily snapshot). **Always filter to the
  latest run:** `WHERE dim.RUN_DATE = (SELECT MAX(RUN_DATE) FROM <same table>)`.
- `RUN_DATE` is also the app's "data freshness" marker (see `buildSnowflakeFreshnessQuery`).

| Field used | Column | Notes |
|------------|--------|-------|
| id | `CRM_OPPORTUNITY_ID` | 18-char Salesforce id; the join key everywhere. |
| stage | `OPPORTUNITY_STAGE_NAME` | Prefixed `"00 - ..."` through `"08 - Closed"`; `"Lost"` is unprefixed. |
| type | `OPPORTUNITY_TYPE` | |
| close date | `CALENDAR_CLOSEDATE` | |
| created date | `OPPORTUNITY_CREATED_DATE` | |
| SC engagement | `OPPORTUNITY_SERVICES_ENGAGED` | |
| D-Score | `OPPORTUNITY_D_SCORE_LATEST` | Latest deal-health score. |
| snapshot date | `SOURCE_SNAPSHOT_DATE` | |

**Masked / empty on this table — do NOT use (use the join instead):**
- `OPPORTUNITY_NAME` → masked (always NULL). Use `stg.NAME` from staging.
- `OPPORTUNITY_TERRITORY_NAME` → empty at source. Resolve via account territory + roster.
- `OPPORTUNITY_SC_MANAGER_NOTES` → empty at source. Use `SC_MANAGER_NOTES_C` from the SFDC-fields snapshot.

### Joins

**Opportunity name, notes, SC assignment, account link** —
`FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2` (alias `stg`)
- Join `dim.CRM_OPPORTUNITY_ID = stg.ID`.
- **SCD2 current-version sentinel is `VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'`, NOT `NULL`.** This trips everyone up. Every SCD2 table below uses the same sentinel.
- Fields: `NAME` (opp name), `RED_FLAGS_C` (→ SC notes), `NEXT_STEP_C` (→ AE next steps), `MANAGER_NOTES_C`, `PRODUCT_SPECIALIST_NOTES_C`, `OPPORTUNITY_NUMBER_C`, `ACCOUNT_ID` (→ account join), `NAME_OF_SC_C` (→ the SC's `USER_ID`, the scoping key).

**Account name** — `FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2` (alias `acc`)
- Join `stg.ACCOUNT_ID = acc.ID` + the SCD2 sentinel. Fields: `NAME`, `ASSIGNED_TERRITORY_ID_C` (→ roster).

**SC full name** — `FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY` (alias `sc_user`)
- Join `stg.NAME_OF_SC_C = sc_user.USER_ID`. Dedupe with `QUALIFY ROW_NUMBER() OVER (PARTITION BY USER_ID ...) = 1`.
- This table is also the **identity resolver** (see §4).

**Owner (primary)** — `FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY` (alias `curated`)
- `OWNER_ACTUAL_NAME__C_OPPT`, filtered to `MAX(SOURCE_SNAPSHOT_DATE)`. Most reliable owner source (confirmed against known-good cases).

**Owner (fallback)** — `FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT` (alias `funnel`)
- `OPP_OWNER_NAME`, latest `SNAPSHOT_DATE`. Used only when an opp is absent from the curated table: `COALESCE(curated.OWNER_ACTUAL_NAME__C_OPPT, funnel.OPP_OWNER_NAME)`.
- We tested `SA_ACTIVITY_DAILY_SNAPSHOT` as an owner source and **dropped it** — 3% coverage and it agreed with the curated table only 0.7% of the time.

**Amount (ARR)** — `PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING` (alias `arr`)
- `SUM(product_arr_usd)` where `is_total_booking = 1`, grouped per opp, latest `source_snapshot_date`. This is the value the ARR-threshold scope filters on.

**SC Manager notes** — `FUNCTIONAL.GTM_SALES_OPS.DIM_CRM_OPPORTUNITIES_SFDC_FIELDS_DAILY_SNAPSHOT` (alias `sfdc_fields`)
- `SC_MANAGER_NOTES_C`, deduped to latest `SOURCE_SNAPSHOT_DATE`.

**Territory** — `FUNCTIONAL.GTM_SALES_OPS.ROSTER` (alias `roster`)
- Join `acc.ASSIGNED_TERRITORY_ID_C = roster.TERRITORY_ID`; `TERRITORY_NAME`, deduped per territory.

**Latest D-Score review date** — see §2 (joined as a per-opp `MAX(VALID_FROM_TIMESTAMP)` sub-select).

### Scoping (how "my opportunities" is defined)

```sql
WHERE dim.RUN_DATE = (SELECT MAX(RUN_DATE) FROM ...)   -- latest snapshot
  AND stg.NAME_OF_SC_C IN (<the SC USER_ID(s)>)        -- this SC (or a manager's team)
  AND (SUBSTRING(dim.OPPORTUNITY_STAGE_NAME,1,2) IN ('00'..'08')  -- active pipeline
       OR dim.OPPORTUNITY_STAGE_NAME = 'Lost')
  -- optional: arr.product_arr_usd >= <threshold>
  -- optional: dim.CALENDAR_CLOSEDATE BETWEEN <from> AND <to>
```

---

## 2. Dispassionate Reviews (D-Score)

Source: `CLEANSED.SALESFORCE.SALESFORCE_DISPASSIONATE_REVIEW_C_SCD2` — a view over
the Salesforce `Dispassionate_Review__c` custom object. See
`buildDispassionateReviewsQuery`. **One opportunity has many reviews** (one per
D-Score review event over time), so this returns one row *per review*, not per opp.

| Field | Column | Notes |
|-------|--------|-------|
| review id (PK) | `ID` | 18-char Salesforce record id, unique per review. |
| opportunity FK | `OPPORTUNITY_C` | Already in 18-char `CRM_OPPORTUNITY_ID` form — joins to `dim` directly, no normalization. |
| review label | `NAME` | Embeds the review date, e.g. `"... D-Score 2026-05-26"`. |
| deleted flag | `IS_DELETED` | Filter `= FALSE`. |
| review timestamp | `VALID_FROM_TIMESTAMP` | **The usable per-review timestamp** (see below). |
| version end | `VALID_TO_TIMESTAMP` | SCD2 sentinel `'9999-12-31 00:00:00.000'` = current version. |

**13 categorical score dimensions** (VARCHAR; the leading digit is the sub-score,
e.g. `"2 - 71% to 85%; ..."`), each with a matching free-text notes column:

| Score column | Meaning |
|--------------|---------|
| `HAVE_WE_COMPLETED_APPROPRIATE_DISCOVERY_C` | discovery |
| `LEVEL_OF_FUNCTIONAL_FIT_TO_REQUIREMENTS_C` | solution fit |
| `HAVE_WE_ARCHITECTED_THE_FULL_SOLUTION_C` | architecture |
| `COMPLEXITY_OF_INTEGRATION_REQUIREMENTS_C` | integration |
| `ENGAGEMENT_OF_CUSTOMER_SECURITY_TEAM_C` | security |
| `BUSINESS_CASE_ROI_ANALYSIS_COMPLETED_C` | net value / ROI |
| `COMPETITIVENESS_AGAINST_TECH_FUNCT_REQ_S_C` | competitiveness |
| `HOW_MANY_TECH_ALLIANCE_PARTNERS_NEEDED_C` | partners |
| `HOW_WELL_ENGAGED_ALIGNED_ARE_WE_TO_IT_C` | IT alignment |
| `KEY_GOALS_FOR_CUST_S_EXEC_STAKEHOLDERS_C` | exec goals |
| `STAGE_OF_SERVICES_SCOPING_C` | services scoping |
| `STATUS_OF_ADVANCED_CUSTOM_DEMO_C` | advanced demo |
| `TYPE_OF_HANDS_ON_ACCESS_BEING_PROVIDED_C` | testing access |

Notes columns follow the pattern `*_SCORE_NOTES_C` (e.g. `DISCOVERY_SCORE_NOTES_C`).

**Gotcha:** `CREATED_DATE`, `LAST_MODIFIED_DATE`, and `SYSTEM_MODSTAMP` are all
NULL at the source (masked/unsynced). That's why `VALID_FROM_TIMESTAMP` is the
per-review timestamp we rely on.

```sql
WHERE OPPORTUNITY_C IN (<opp ids>)
  AND VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'   -- current version only
  AND IS_DELETED = FALSE
```

---

## 3. Activities

Source: `FUNCTIONAL.GTM_SALES_OPS.SA_ACTIVITY_DAILY_SNAPSHOT`. See
`buildActivitiesQuery`. This is the highest-volume domain (millions of rows) and
has the trickiest freshness semantics.

| Field | Column | Notes |
|-------|--------|-------|
| id (PK) | `ID` | |
| account | `ACCOUNTID`, `ACCOUNT_NAME` | |
| date | `ACTIVITY_DATE` | **Unreliable as a watermark** — routinely backdated and future-dated. |
| period rollups | `ACTIVITY_MONTH`, `ACTIVITY_YEAR_QUARTER`, `ACTIVITY_YEAR_MONTH` | |
| subject/type | `SUBJECT`, `TYPE`, `SUB_TYPE` | |
| duration | `DURATION_OF_HOURS` | |
| owner | `OWNER_ID`, `OWNER_NAME_CLEAN`, `OWNER_ROLE` | who the activity is assigned to |
| **creator** | `CREATED_BY_ID`, `CREATED_BY_NAME` | **the scoping key — see below** |
| related record | `WHATID`, `WHATID_TYPE` | e.g. `"Account"`, `"Opportunity"` |
| opp/account match | `ACTIVITY_MATCH_OPP_NAME`, `ACTIVITY_MATCH_ACCOUNT_NAME` | |
| flag | `IS_SALES_ACTIVITY` | |
| snapshot | `SOURCE_SNAPSHOT_DATE` | re-stamped daily — see below |

### Scope by creator, not owner

Activities are scoped by `CREATED_BY_ID` (who *logged* it), not `OWNER_ID` (who
it's assigned to). The two can differ (e.g. an admin logging on an SE's behalf),
and "SE activity logged" should reflect who did the logging.

### The daily re-stamp trap (critical for incremental sync)

`SA_ACTIVITY_DAILY_SNAPSHOT` writes a **fresh `SOURCE_SNAPSHOT_DATE` for every
still-active activity every day.** A single activity ID can have 900+ snapshot
rows. Consequences:

1. **Dedup to one row per ID** before use:
   `QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY SOURCE_SNAPSHOT_DATE DESC) = 1`.
2. **`SOURCE_SNAPSHOT_DATE` cannot tell "new" from "still around."** Neither can
   `ACTIVITY_DATE` (backdated/future-dated). The only reliable "this record is
   new" signal is **first appearance**:
   `MIN(SOURCE_SNAPSHOT_DATE) OVER (PARTITION BY ID) >= <since>`.
   That's how incremental sync detects genuinely-new activities.

---

## 4. Identity & org structure

`FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY` is the people table — it maps
between email, Snowflake `USER_ID`, and reporting lines. See
[`services/sc-lookup.js`](services/sc-lookup.js).

- **Email → SC identity:** `WHERE LOWER(EMAIL) = LOWER(<email>)` → `USER_ID`, `FULL_NAME`. Dedupe per `EMAIL`. The resulting `USER_ID` is what scopes opportunities (`stg.NAME_OF_SC_C`) and, indirectly, activities.
- **Manager detection:** don't trust `ROLE_TYPE` (managers and ICs share codes). Instead check whether anyone's current `MANAGER_EMPLOYEE_ID` points back at this person's `EMPLOYEE_ID` (with `END_DATE >= CURRENT_DATE`). A manager scoping to their team resolves each report's email to a `USER_ID` and passes the set into the opportunity query.

---

## 5. Patterns worth stealing

These are the reusable lessons, independent of the specific tables:

1. **`DESCRIBE VIEW`/`DESCRIBE TABLE` before you write anything.** Column names
   here are non-obvious and guessing from training data wastes round-trips.
2. **SCD2 current-version filter is `VALID_TO_TIMESTAMP = '9999-12-31 00:00:00.000'`,
   not `NULL`.** Applies to every `*_SCD2` table.
3. **Daily-snapshot tables need a latest-partition filter** — either
   `RUN_DATE = MAX(RUN_DATE)` or `QUALIFY ROW_NUMBER() ... ORDER BY <snapshot> DESC = 1`
   — or you'll multiply every row by its history depth.
4. **A NULL might be masked, not empty.** Cross-check a suspicious all-NULL
   column against an unmasked twin (this app swapped 3 masked opp columns).
5. **Pick the right "new record" signal.** Timestamps that get re-stamped
   (`SOURCE_SNAPSHOT_DATE`) or edited by users (`ACTIVITY_DATE`) can't gate
   incremental pulls. Use first-appearance (`MIN() OVER`) for re-stamped
   snapshots and version-start (`VALID_FROM_TIMESTAMP`) for SCD2.
6. **Make re-pulls idempotent.** Because rows are deduped to their latest
   version, re-pulling an overlapping window and upserting (`ON CONFLICT (id) DO
   UPDATE`) is safe — so incremental sync can use a safety-buffer overlap without
   creating duplicates.

---

## Table reference (quick index)

| Domain | Table | Role |
|--------|-------|------|
| Opps | `FOUNDATIONAL.CUSTOMER.DIM_CRM_OPPORTUNITIES_DAILY_SNAPSHOT` | Base opp snapshot |
| Opps | `FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_OPPORTUNITY_SCD2` | Name, notes, SC, account link |
| Opps | `FOUNDATIONAL.CUSTOMER_STAGING.STG_SALESFORCE_ACCOUNT_SCD2` | Account name, territory link |
| Opps | `FUNCTIONAL.GTM_SALES_OPS.CURATED_OPPORTUNITIES_HISTORY` | Owner (primary) |
| Opps | `FUNCTIONAL.MARKETING_ANALYTICS.OPP_CM_FUNNEL_METRIC_DAILY_SNAPSHOT` | Owner (fallback) |
| Opps | `PRESENTATION.ENTERPRISE_METRICS.OPPORTUNITY_LEVEL_PIPELINE_BOOKING` | ARR / amount |
| Opps | `FUNCTIONAL.GTM_SALES_OPS.DIM_CRM_OPPORTUNITIES_SFDC_FIELDS_DAILY_SNAPSHOT` | SC manager notes |
| Opps | `FUNCTIONAL.GTM_SALES_OPS.ROSTER` | Territory name |
| D-Score | `CLEANSED.SALESFORCE.SALESFORCE_DISPASSIONATE_REVIEW_C_SCD2` | Dispassionate reviews |
| Activities | `FUNCTIONAL.GTM_SALES_OPS.SA_ACTIVITY_DAILY_SNAPSHOT` | SE activities |
| Identity | `FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY` | Email ↔ USER_ID, reporting lines |
