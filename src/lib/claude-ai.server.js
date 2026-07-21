const MODEL_ID = 'us.anthropic.claude-sonnet-4-6';

/**
 * @typedef {Object} SummaryRequest
 * @property {string} opportunityName
 * @property {string} account
 * @property {string} stage
 * @property {number} amount
 * @property {string} closeDate
 * @property {string} owner
 * @property {string} scNotes
 * @property {string} nextSteps
 * @property {string} managerNotes
 * @property {string} scManagerNotes
 * @property {string} productSpecialistNotes
 * @property {number} dScore
 */

/**
 * Generate an AI summary for an opportunity via Zendesk's internal
 * AI gateway (Bedrock-compatible, bearer-token authenticated).
 * @param {SummaryRequest} opp
 * @returns {Promise<string>}
 */
export async function generateOpportunitySummary(opp) {
  const endpoint = process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME;
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;

  if (!endpoint || !token) {
    throw new Error('AWS_ENDPOINT_URL_BEDROCK_RUNTIME / AWS_BEARER_TOKEN_BEDROCK are not configured');
  }

  const prompt = `You are a sales operations analyst. Generate a concise 3-5 sentence summary of this sales opportunity. Focus on:
- Current status and key risks
- Stakeholder engagement and next steps
- Discrepancies between the SC notes and AE next steps
- Timeline concerns (if stuck in a stage for a long time)
- Any compelling events or blockers mentioned in notes

Opportunity Details:
- Name: ${opp.opportunityName}
- Account: ${opp.account}
- Stage: ${opp.stage}
- ARR: $${opp.amount.toLocaleString()}
- Close Date: ${opp.closeDate}
- Owner: ${opp.owner}
- D-Score: ${opp.dScore}

SC Notes:
${opp.scNotes}

AE Next Steps:
${opp.nextSteps}

Manager Notes:
${opp.managerNotes}

SC Manager Notes:
${opp.scManagerNotes}

Product Specialist Notes:
${opp.productSpecialistNotes}

Provide only the summary text, no preamble.`;

  const response = await fetch(`${endpoint}/model/${MODEL_ID}/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 300,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI gateway request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((block) => block.type === 'text');
  return textBlock?.text ?? '';
}
