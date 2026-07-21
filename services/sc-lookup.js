import { executeQuery } from '../snowflake-connection.js';

/**
 * Resolve a logged-in user's email to their Snowflake SC identity.
 * @param {string} email
 * @returns {Promise<{ userId: string, fullName: string } | null>}
 */
export async function resolveScUserId(email) {
  const sql = `
    SELECT USER_ID, FULL_NAME, EMAIL
    FROM FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY
    WHERE LOWER(EMAIL) = LOWER('${email.replace(/'/g, "''")}')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY EMAIL ORDER BY USER_ID) = 1
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
 * Emails with no current USER_HISTORY record are silently omitted.
 * @param {string[]} emails
 * @param {string} requestingEmail - identity to run the Snowflake query as
 * @returns {Promise<string[]>}
 */
export async function resolveScUserIds(emails, requestingEmail) {
  if (emails.length === 0) {
    return [];
  }

  const emailList = emails.map(e => `LOWER('${e.replace(/'/g, "''")}')`).join(', ');
  const sql = `
    SELECT USER_ID, EMAIL
    FROM FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY
    WHERE LOWER(EMAIL) IN (${emailList})
    QUALIFY ROW_NUMBER() OVER (PARTITION BY EMAIL ORDER BY USER_ID) = 1
  `;

  const rows = await executeQuery(sql, undefined, requestingEmail);
  return rows.map(row => row.USER_ID);
}

/**
 * Determine whether a user currently has direct reports (i.e. is a manager),
 * by checking the reporting line in USER_HISTORY. ROLE_TYPE (e.g. "SC" vs "SS")
 * is not a reliable manager signal — managers and ICs can share the same code —
 * so this checks whether anyone's current MANAGER_EMPLOYEE_ID points back to them.
 * @param {string} email
 * @returns {Promise<boolean | null>} true/false if resolved, or null if this
 *   email has no current USER_HISTORY record (e.g. not yet provisioned as an SC)
 */
export async function checkHasDirectReports(email) {
  const sql = `
    SELECT
      (
        SELECT COUNT(DISTINCT uh.USER_ID)
        FROM FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY uh
        WHERE uh.MANAGER_EMPLOYEE_ID = m.EMPLOYEE_ID
          AND uh.END_DATE >= CURRENT_DATE
      ) AS DIRECT_REPORTS
    FROM (
      SELECT EMPLOYEE_ID
      FROM FUNCTIONAL.MARKETING_ANALYTICS.USER_HISTORY
      WHERE LOWER(EMAIL) = LOWER('${email.replace(/'/g, "''")}')
        AND END_DATE >= CURRENT_DATE
      QUALIFY ROW_NUMBER() OVER (PARTITION BY EMAIL ORDER BY END_DATE DESC) = 1
    ) m
  `;

  const rows = await executeQuery(sql, undefined, email);

  if (rows.length === 0) {
    return null;
  }

  return Number(rows[0].DIRECT_REPORTS) > 0;
}
