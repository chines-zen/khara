import 'dotenv/config';
import { connectToSnowflake, executeQuery, closeConnection } from './snowflake-connection.js';

async function main() {
  console.log('Connecting to Snowflake...');
  await connectToSnowflake();
  console.log('Connected.\n');

  const sql1 = `
    SELECT COUNT(*) AS TOTAL, COUNT(MOST_RECENT_DISPASSIONATE_REVIEW_C) AS NON_NULL
    FROM CLEANSED.SALESFORCE.SALESFORCE_OPPORTUNITY_FORMULA_DAILY_SNAPSHOT
    WHERE RUN_DATE = (SELECT MAX(RUN_DATE) FROM CLEANSED.SALESFORCE.SALESFORCE_OPPORTUNITY_FORMULA_DAILY_SNAPSHOT)
  `;
  const r1 = await executeQuery(sql1);
  console.log('MOST_RECENT_DISPASSIONATE_REVIEW_C null rate (latest run):', JSON.stringify(r1));

  const sql2 = `
    SELECT COUNT(*) AS TOTAL, COUNT(MOST_RECENT_DISPASSIONATE_ID__C) AS NON_NULL
    FROM PRESENTATION.EDA_SALES_MARKETING.MHS_PRESALES_ACTION_CENTER_METRICS
    WHERE TIME_STAMP = (SELECT MAX(TIME_STAMP) FROM PRESENTATION.EDA_SALES_MARKETING.MHS_PRESALES_ACTION_CENTER_METRICS)
  `;
  const r2 = await executeQuery(sql2);
  console.log('MOST_RECENT_DISPASSIONATE_ID__C null rate (latest timestamp):', JSON.stringify(r2));

  // sample any non-null dispassionate review across all run dates for this table
  const sql3 = `
    SELECT ID, MOST_RECENT_DISPASSIONATE_REVIEW_C, RUN_DATE
    FROM CLEANSED.SALESFORCE.SALESFORCE_OPPORTUNITY_FORMULA_DAILY_SNAPSHOT
    WHERE MOST_RECENT_DISPASSIONATE_REVIEW_C IS NOT NULL
    LIMIT 5
  `;
  const r3 = await executeQuery(sql3);
  console.log(`\nAny non-null dispassionate review ever (${r3.length}):`, JSON.stringify(r3, null, 2));

  await closeConnection();
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
