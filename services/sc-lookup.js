import { executeQuery } from "../snowflake-connection.js";

function quote(email) {
  return email.replace(/'/g, "''");
}

/**
 * Resolve everything we need about a logged-in user from the current sales
 * employee role history in a single round trip: their Salesforce identity
 * (SFDC_USER_ID / FULL_NAME) *and* whether they
 * have direct reports. Previously these were two separate queries against the
 * same table on every cold login (resolveScUserId + checkHasDirectReports),
 * which is the bulk of the login-time Snowflake traffic.
 *
 * The two lookups keep their original, deliberately different semantics rather
 * than being folded into one row:
 *   - identity: no role-end-date filter, deduped per email by the newest role.
 *     A departed SE still resolves, so their cached opps keep working.
 *   - current_record: XC_ROLE_END_DATE is open or in the future. Manager status is
 *     only meaningful for a currently-employed record.
 *
 * @param {string} email
 * @returns {Promise<{ userId: string, fullName: string, isManager: boolean | null } | null>}
 *   null if this email has no role-history record at all. isManager is null when
 *   there's no *current* record (e.g. not yet provisioned as an SC), matching
 *   checkHasDirectReports' contract.
 */
export async function resolveUserIdentity(email) {
  const safeEmail = quote(email);
  const sql = `
    WITH identity AS (
      SELECT SFDC_USER_ID AS USER_ID, FULL_NAME
      FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY
      WHERE LOWER(SFDC_USER_EMAIL) = LOWER('${safeEmail}')
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LOWER(SFDC_USER_EMAIL)
        ORDER BY XC_ROLE_END_DATE DESC NULLS LAST,
                 XC_ROLE_START_DATE DESC NULLS LAST,
                 SFDC_USER_ID
      ) = 1
    ),
    current_record AS (
      SELECT EMPLOYEE_ID
      FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY
      WHERE LOWER(SFDC_USER_EMAIL) = LOWER('${safeEmail}')
        AND (XC_ROLE_END_DATE IS NULL OR XC_ROLE_END_DATE >= CURRENT_DATE)
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LOWER(SFDC_USER_EMAIL)
        ORDER BY XC_ROLE_END_DATE DESC NULLS LAST,
                 XC_ROLE_START_DATE DESC NULLS LAST
      ) = 1
    )
    SELECT
      identity.USER_ID,
      identity.FULL_NAME,
      (SELECT COUNT(*) FROM current_record) AS HAS_CURRENT_RECORD,
      (
        SELECT COUNT(DISTINCT uh.SFDC_USER_ID)
        FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY uh
        WHERE uh.MANAGER_EMPLOYEE_ID = (SELECT EMPLOYEE_ID FROM current_record)
          AND (uh.XC_ROLE_END_DATE IS NULL OR uh.XC_ROLE_END_DATE >= CURRENT_DATE)
      ) AS DIRECT_REPORTS
    FROM identity
  `;

  const rows = await executeQuery(sql, undefined, email);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  return {
    userId: row.USER_ID,
    fullName: row.FULL_NAME,
    // No current employment record -> manager status is unknown, not false.
    isManager:
      Number(row.HAS_CURRENT_RECORD) > 0
        ? Number(row.DIRECT_REPORTS) > 0
        : null,
  };
}

/**
 * Resolve a logged-in user's email to their Snowflake SC identity.
 *
 * Prefer resolveUserIdentity() on the login path — it returns this plus manager
 * status in one query. This remains for callers that only have an email and no
 * cached identity to fall back on (see index.js's /api/opportunities).
 * @param {string} email
 * @returns {Promise<{ userId: string, fullName: string } | null>}
 */
export async function resolveScUserId(email) {
  const sql = `
    SELECT SFDC_USER_ID AS USER_ID, FULL_NAME, SFDC_USER_EMAIL AS EMAIL
    FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY
    WHERE LOWER(SFDC_USER_EMAIL) = LOWER('${email.replace(/'/g, "''")}')
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY LOWER(SFDC_USER_EMAIL)
      ORDER BY XC_ROLE_END_DATE DESC NULLS LAST,
               XC_ROLE_START_DATE DESC NULLS LAST,
               SFDC_USER_ID
    ) = 1
  `;

  const rows = await executeQuery(sql, undefined, email);

  if (rows.length === 0) {
    return null;
  }

  return { userId: rows[0].USER_ID, fullName: rows[0].FULL_NAME };
}

/**
 * Resolve multiple emails to their Snowflake SC USER_IDs in one query (used
 * for the manager-only "Sales Engineers" scoping — see services/opp-scope.js).
 * Emails with no current role-history record are silently omitted.
 * @param {string[]} emails
 * @param {string} requestingEmail - identity to run the Snowflake query as
 * @returns {Promise<string[]>}
 */
export async function resolveScUserIds(emails, requestingEmail) {
  if (emails.length === 0) {
    return [];
  }

  const emailList = emails
    .map((e) => `LOWER('${e.replace(/'/g, "''")}')`)
    .join(", ");
  const sql = `
    SELECT SFDC_USER_ID AS USER_ID, SFDC_USER_EMAIL AS EMAIL
    FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY
    WHERE LOWER(SFDC_USER_EMAIL) IN (${emailList})
      AND (XC_ROLE_END_DATE IS NULL OR XC_ROLE_END_DATE >= CURRENT_DATE)
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY LOWER(SFDC_USER_EMAIL)
      ORDER BY XC_ROLE_END_DATE DESC NULLS LAST,
               XC_ROLE_START_DATE DESC NULLS LAST,
               SFDC_USER_ID
    ) = 1
  `;

  const rows = await executeQuery(sql, undefined, requestingEmail);
  return rows.map((row) => row.USER_ID);
}

/**
 * Resolve a batch of onboarding emails and return the display data needed by
 * the setup UI. Only currently-employed role-history records count as found.
 */
export async function resolveOnboardingUsers(emails, requestingEmail) {
  if (emails.length === 0) return [];

  const emailValues = emails
    .map((email) => `('${email.replace(/'/g, "''")}')`)
    .join(", ");
  const safeRequestingEmail = quote(requestingEmail);
  const sql = `
    WITH requested AS (
      SELECT column1::STRING AS email
      FROM VALUES ${emailValues}
    ),
    target AS (
      SELECT r.email, uh.SFDC_USER_ID AS USER_ID, uh.FULL_NAME, uh.EMPLOYEE_ID,
             ROW_NUMBER() OVER (
               PARTITION BY LOWER(r.email)
               ORDER BY uh.XC_ROLE_END_DATE DESC NULLS LAST,
                        uh.XC_ROLE_START_DATE DESC NULLS LAST,
                        uh.SFDC_USER_ID
             ) AS rn
      FROM requested r
      JOIN FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY uh
        ON LOWER(uh.SFDC_USER_EMAIL) = LOWER(r.email)
       AND (uh.XC_ROLE_END_DATE IS NULL OR uh.XC_ROLE_END_DATE >= CURRENT_DATE)
    ),
    requester AS (
      SELECT EMPLOYEE_ID
      FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY
      WHERE LOWER(SFDC_USER_EMAIL) = LOWER('${safeRequestingEmail}')
        AND (XC_ROLE_END_DATE IS NULL OR XC_ROLE_END_DATE >= CURRENT_DATE)
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LOWER(SFDC_USER_EMAIL)
        ORDER BY XC_ROLE_END_DATE DESC NULLS LAST,
                 XC_ROLE_START_DATE DESC NULLS LAST
      ) = 1
    )
    SELECT
      target.email,
      target.USER_ID,
      target.FULL_NAME,
      EXISTS (
        SELECT 1
        FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY report
        WHERE report.SFDC_USER_ID = target.USER_ID
          AND report.MANAGER_EMPLOYEE_ID = (SELECT EMPLOYEE_ID FROM requester)
          AND (report.XC_ROLE_END_DATE IS NULL OR report.XC_ROLE_END_DATE >= CURRENT_DATE)
      ) AS IS_DIRECT_REPORT
    FROM target
    WHERE target.rn = 1
  `;

  const rows = await executeQuery(sql, undefined, requestingEmail);
  const byEmail = new Map(
    rows.map((row) => [String(row.EMAIL).toLowerCase(), row]),
  );

  return emails.map((email) => {
    const row = byEmail.get(email.toLowerCase());
    return {
      email,
      found: Boolean(row),
      userId: row?.USER_ID ?? null,
      fullName: row?.FULL_NAME ?? null,
      isDirectReport: row ? Boolean(row.IS_DIRECT_REPORT) : false,
    };
  });
}

/**
 * Determine whether a user currently has direct reports (i.e. is a manager),
 * by checking the reporting line in role history. ROLE_TYPE (e.g. "SC" vs "SS")
 * is not a reliable manager signal — managers and ICs can share the same code —
 * so this checks whether anyone's current MANAGER_EMPLOYEE_ID points back to them.
 * @param {string} email
 * @returns {Promise<boolean | null>} true/false if resolved, or null if this
 *   email has no current role-history record (e.g. not yet provisioned as an SC)
 */
export async function checkHasDirectReports(email) {
  const sql = `
    SELECT
      (
        SELECT COUNT(DISTINCT uh.SFDC_USER_ID)
        FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY uh
        WHERE uh.MANAGER_EMPLOYEE_ID = m.EMPLOYEE_ID
          AND (uh.XC_ROLE_END_DATE IS NULL OR uh.XC_ROLE_END_DATE >= CURRENT_DATE)
      ) AS DIRECT_REPORTS
    FROM (
      SELECT EMPLOYEE_ID
      FROM FUNCTIONAL.MARKETING_ANALYTICS.SALES_EMPLOYEE_ROLE_HISTORY
      WHERE LOWER(SFDC_USER_EMAIL) = LOWER('${email.replace(/'/g, "''")}')
        AND (XC_ROLE_END_DATE IS NULL OR XC_ROLE_END_DATE >= CURRENT_DATE)
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LOWER(SFDC_USER_EMAIL)
        ORDER BY XC_ROLE_END_DATE DESC NULLS LAST,
                 XC_ROLE_START_DATE DESC NULLS LAST
      ) = 1
    ) m
  `;

  const rows = await executeQuery(sql, undefined, email);

  if (rows.length === 0) {
    return null;
  }

  return Number(rows[0].DIRECT_REPORTS) > 0;
}
