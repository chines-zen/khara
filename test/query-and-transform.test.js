import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpportunitiesQuery,
  buildScOpportunitiesTargetedQuery,
} from "../snowflake-queries.js";
import { transformOpportunity } from "../services/sc-opportunities-cache.js";

test("query builders accept valid opportunity IDs", () => {
  const sql = buildOpportunitiesQuery({
    opportunityIds: ["006PC00000VkYRRYA3"],
    closeMonths: ["2026-08"],
  });

  assert.match(sql, /006PC00000VkYRRYA3/);
  assert.match(sql, /2026-08/);
});

test("identity joins use the current sales employee role history", () => {
  const ownerSql = buildOpportunitiesQuery({
    ownerEmails: ["jamie.strauss@zendesk.com"],
  });

  const targetedSql = buildScOpportunitiesTargetedQuery([
    { id: "006PC00000WQT8nYAH", amount: 1, scUserId: "005PC00000xPSojYAG" },
  ]);

  assert.match(
    ownerSql,
    /FUNCTIONAL\.MARKETING_ANALYTICS\.SALES_EMPLOYEE_ROLE_HISTORY/,
  );
  assert.match(
    targetedSql,
    /FUNCTIONAL\.MARKETING_ANALYTICS\.SALES_EMPLOYEE_ROLE_HISTORY/,
  );
  assert.match(targetedSql, /SFDC_USER_ID/);
  assert.match(targetedSql, /XC_ROLE_END_DATE/);
});

test("query builders reject unsafe or malformed identifiers", () => {
  assert.throws(
    () => buildOpportunitiesQuery({ opportunityIds: ["safe' OR 1=1 --"] }),
    /Invalid Snowflake identifier/,
  );
  assert.throws(
    () => buildOpportunitiesQuery({ closeMonths: ["2026-99"] }),
    /Invalid close month/,
  );
  assert.throws(
    () =>
      buildScOpportunitiesTargetedQuery([
        { id: "bad' OR 1=1 --", amount: 1, scUserId: "005123" },
      ]),
    /Invalid opportunity ID/,
  );
});

test("opportunity transformation returns a stable null-safe API shape", () => {
  const opportunity = transformOpportunity({
    ID: null,
    NAME: null,
    ACCOUNT: null,
    STAGE: null,
    AMOUNT: null,
    CLOSE_DATE: null,
    CREATED_DATE: null,
    OWNER: null,
    SC_NOTES: null,
    NEXT_STEPS: null,
    MANAGER_NOTES: null,
    SC_MANAGER_NOTES: null,
    SC_ENGAGEMENT_TYPE: null,
    NAME_OF_SC: null,
    SC_USER_ID: null,
    D_SCORE: null,
    OPPORTUNITY_NUMBER: null,
    SNAPSHOT_DATE: null,
  });

  assert.equal(opportunity.id, "");
  assert.equal(opportunity.name, "Unnamed Opportunity");
  assert.equal(opportunity.closeDate, "");
  assert.equal(opportunity.account, "Unknown Account");
  assert.equal(opportunity.owner, "Not Available");
});
