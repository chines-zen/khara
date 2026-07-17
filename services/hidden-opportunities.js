import { pool } from '../db/index.js';

/**
 * Get all hidden opportunity IDs for a user
 * @param {number} userId
 * @returns {Promise<string[]>} Array of opportunity IDs
 */
export async function getHiddenOpportunities(userId) {
  const query = `
    SELECT opportunity_id
    FROM hidden_opportunities
    WHERE user_id = $1
  `;

  const result = await pool.query(query, [userId]);
  return result.rows.map(row => row.opportunity_id);
}

/**
 * Hide an opportunity for a user
 * @param {number} userId
 * @param {string} opportunityId
 */
export async function hideOpportunity(userId, opportunityId) {
  const query = `
    INSERT INTO hidden_opportunities (user_id, opportunity_id, hidden_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, opportunity_id) DO NOTHING
  `;

  await pool.query(query, [userId, opportunityId]);
}

/**
 * Unhide an opportunity for a user
 * @param {number} userId
 * @param {string} opportunityId
 */
export async function unhideOpportunity(userId, opportunityId) {
  const query = `
    DELETE FROM hidden_opportunities
    WHERE user_id = $1 AND opportunity_id = $2
  `;

  await pool.query(query, [userId, opportunityId]);
}

/**
 * Check if an opportunity is hidden for a user
 * @param {number} userId
 * @param {string} opportunityId
 * @returns {Promise<boolean>}
 */
export async function isOpportunityHidden(userId, opportunityId) {
  const query = `
    SELECT 1 FROM hidden_opportunities
    WHERE user_id = $1 AND opportunity_id = $2
  `;

  const result = await pool.query(query, [userId, opportunityId]);
  return result.rows.length > 0;
}
