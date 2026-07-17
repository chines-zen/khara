import 'dotenv/config';
import { connectToSnowflake, executeQuery, closeConnection } from './snowflake-connection.js';
import { buildOpportunitiesQuery } from './snowflake-queries.js';

// Test opportunity IDs
const testOpportunityIds = [
  '006PC00000UhFIfYAL',
  '006PC00000VICiQYA1',
  '0066R00000ugmYLQAY',
  '006PC00000Lz2yTYAR',
  '006PC00000VcAe1YAF',
];

async function testSnowflake() {
  try {
    console.log('🔌 Connecting to Snowflake...');
    await connectToSnowflake();

    console.log('\n📊 Querying opportunities...');
    const sql = buildOpportunitiesQuery({ opportunityIds: testOpportunityIds });

    console.log('\n📝 SQL Query:');
    console.log(sql.substring(0, 500) + '...\n');

    const rows = await executeQuery(sql);

    console.log(`✅ Found ${rows.length} opportunities:\n`);

    rows.forEach((row, i) => {
      console.log(`${i + 1}. ${row.NAME} (${row.ID})`);
      console.log(`   Account: ${row.ACCOUNT}`);
      console.log(`   Stage: ${row.STAGE}`);
      console.log(`   Owner: ${row.OWNER || 'Not Available'}`);
      console.log(`   Amount: $${row.AMOUNT || 0}`);
      console.log(`   D-Score: ${row.D_SCORE || 0}`);
      console.log('');
    });

    console.log('✅ Snowflake test completed successfully!');

    await closeConnection();
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testSnowflake();
