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

  const rows = await executeQuery(sql);

  if (rows.length === 0) {
    return null;
  }

  return { userId: rows[0].USER_ID, fullName: rows[0].FULL_NAME };
}
