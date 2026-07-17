import { pool } from '../db/index.js';
import { generateOpportunitySummary } from '../src/lib/vertex-ai.server.js';

/**
 * Get cached summary or generate new one
 * @param {string} opportunityId - Salesforce opportunity ID
 * @param {object} opportunityData - Full opportunity data for AI generation
 * @param {boolean} forceRegenerate - Force regenerate even if cached
 * @returns {Promise<{summary: string, cached: boolean, generatedAt: string}>}
 */
export async function getCachedSummary(opportunityId, opportunityData, forceRegenerate = false) {
  // Try to get from cache first (unless force regenerate)
  if (!forceRegenerate) {
    const cachedSummary = await getCachedSummaryFromDb(opportunityId);

    if (cachedSummary) {
      return {
        summary: cachedSummary.summary,
        cached: true,
        generatedAt: cachedSummary.generated_at,
      };
    }
  }

  // Cache miss or force regenerate - generate new summary with Vertex AI
  console.log(`📝 ${forceRegenerate ? 'Regenerating' : 'Generating new'} AI summary for opportunity ${opportunityId}`);
  const summary = await generateOpportunitySummary(opportunityData);

  // Store in cache (update if exists, insert if not)
  const generatedAt = new Date();
  await storeSummaryInCache(opportunityId, summary, generatedAt);

  return {
    summary,
    cached: false,
    generatedAt: generatedAt.toISOString(),
  };
}

/**
 * Get summary from cache (returns null if not found)
 * No expiration - summaries are kept indefinitely
 */
async function getCachedSummaryFromDb(opportunityId) {
  const query = `
    SELECT summary, generated_at
    FROM opportunity_summaries
    WHERE opportunity_id = $1
  `;

  const result = await pool.query(query, [opportunityId]);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Store summary in cache (upsert - update if exists, insert if not)
 */
async function storeSummaryInCache(opportunityId, summary, generatedAt) {
  const query = `
    INSERT INTO opportunity_summaries (opportunity_id, summary, generated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (opportunity_id)
    DO UPDATE SET
      summary = EXCLUDED.summary,
      generated_at = EXCLUDED.generated_at
  `;

  await pool.query(query, [opportunityId, summary, generatedAt]);
}

/**
 * Invalidate cache for specific opportunity (e.g., when data changes)
 */
export async function invalidateSummaryCache(opportunityId) {
  await pool.query(
    'DELETE FROM opportunity_summaries WHERE opportunity_id = $1',
    [opportunityId]
  );
}

/**
 * Clean up expired summaries
 * NOTE: Summaries are now kept indefinitely, so this is a no-op
 * Keeping function for backwards compatibility
 */
export async function cleanupExpiredSummaries() {
  // No-op: summaries are kept indefinitely
  console.log('✅ Summaries are kept indefinitely (no cleanup needed)');
}
