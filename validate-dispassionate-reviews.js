import 'dotenv/config';
import { pool, initializeDatabase } from './db/index.js';
import { connectToSnowflake, executeQuery, closeConnection } from './snowflake-connection.js';
import { buildDispassionateReviewsQuery } from './snowflake-queries.js';
import {
  getDispassionateReviewsForOpportunity,
} from './services/dispassionate-reviews-cache.js';

// Fixed validation opportunity - user confirmed it has multiple D-Score reviews.
const TEST_OPP_ID = '006PC00000VkYRRYA3';

// Snowflake identity. In service-account mode this is ignored; in EXTERNALBROWSER
// mode it drives the SSO login, so allow overriding via CLI arg or DEV_USER_EMAIL.
const EMAIL = process.argv[2] || process.env.DEV_USER_EMAIL || '';

const results = [];
function check(label, passed, detail = '') {
  results.push({ label, passed });
  console.log(`${passed ? '✅ PASS' : '❌ FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('📦 Ensuring database tables exist...');
  await initializeDatabase();

  console.log('🔌 Connecting to Snowflake...');
  await connectToSnowflake(EMAIL);
  console.log('Connected.\n');

  // --- Step 1: Raw Snowflake query (independent of the service module) ---
  console.log(`📊 Querying Snowflake directly for opp ${TEST_OPP_ID}...`);
  const sql = buildDispassionateReviewsQuery(TEST_OPP_ID);
  const snowflakeRows = await executeQuery(sql, undefined, EMAIL);
  console.log(`   Snowflake returned ${snowflakeRows.length} review row(s).`);
  snowflakeRows.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.NAME} (id=${r.ID}, valid_from=${r.VALID_FROM_TIMESTAMP?.toISOString?.() ?? r.VALID_FROM_TIMESTAMP})`);
  });
  console.log('');
  check('Snowflake returned multiple review rows', snowflakeRows.length > 1, `got ${snowflakeRows.length}`);

  // --- Step 2: Clear any prior cache state so the test is deterministic ---
  console.log('🧹 Clearing prior cache state for this opp...');
  await pool.query('DELETE FROM dispassionate_reviews WHERE opportunity_id = $1', [TEST_OPP_ID]);
  await pool.query('DELETE FROM dispassionate_reviews_sync_meta WHERE opportunity_id = $1', [TEST_OPP_ID]);
  console.log('');

  // --- Step 3: Exercise the real sync-then-read path ---
  console.log('🔄 Running getDispassionateReviewsForOpportunity (cache MISS expected)...');
  const first = await getDispassionateReviewsForOpportunity(TEST_OPP_ID, EMAIL);
  console.log(`   Service returned ${first.reviews.length} review(s), cached=${first.cached}`);
  first.reviews.forEach((r) => {
    console.log(`   - ${r.name}: summed_d_score=${r.summedDScore}`);
  });
  check('Service read-back count matches Snowflake', first.reviews.length === snowflakeRows.length,
    `service=${first.reviews.length} snowflake=${snowflakeRows.length}`);
  check('First call reported cache MISS', first.cached === false);
  check('Every review has a numeric summed_d_score', first.reviews.every((r) => typeof r.summedDScore === 'number'),
    first.reviews.map((r) => r.summedDScore).join(', '));

  // --- Step 4: Verify rows actually persisted in Postgres ---
  const persisted = await pool.query(
    'SELECT id, name, valid_from_timestamp FROM dispassionate_reviews WHERE opportunity_id = $1 ORDER BY valid_from_timestamp',
    [TEST_OPP_ID],
  );
  console.log(`\n💾 Postgres holds ${persisted.rows.length} row(s) for this opp:`);
  persisted.rows.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.name} (id=${r.id})`);
  });
  console.log('');
  check('Postgres persisted count matches Snowflake', persisted.rows.length === snowflakeRows.length,
    `postgres=${persisted.rows.length} snowflake=${snowflakeRows.length}`);

  // --- Step 5: Second call should be a cache HIT with identical rows, no dupes ---
  console.log('🔄 Running getDispassionateReviewsForOpportunity again (cache HIT expected)...');
  const second = await getDispassionateReviewsForOpportunity(TEST_OPP_ID, EMAIL);
  console.log(`   Service returned ${second.reviews.length} review(s), cached=${second.cached}`);
  check('Second call reported cache HIT', second.cached === true);
  check('Re-run did not duplicate rows', second.reviews.length === first.reviews.length,
    `first=${first.reviews.length} second=${second.reviews.length}`);

  // --- Summary ---
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${failed.length === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failed.length} CHECK(S) FAILED`} (${results.length - failed.length}/${results.length})`);
  console.log('='.repeat(50));

  await closeConnection(EMAIL);
  await pool.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('FATAL:', e.message);
  console.error(e);
  try { await closeConnection(EMAIL); } catch { /* ignore */ }
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
