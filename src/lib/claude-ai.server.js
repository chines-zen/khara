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
 * @typedef {Object} TokenValidationResult
 * @property {boolean} ok        - true if the token was accepted by the gateway
 * @property {'auth'|'server'|'network'|'rate_limit'|'config'|'unknown'} [reason]
 * @property {number} [status]   - HTTP status from the gateway, when there was one
 * @property {string} [message]  - human-readable explanation for the UI
 */

/**
 * Validate a Bedrock bearer token by making a minimal (1-token) invoke against
 * the AI gateway. This distinguishes a rejected token (bad/expired credential)
 * from a gateway/server-side problem so callers can react differently — e.g.
 * discard a bad token but keep prompting to retry on a transient outage.
 *
 * @param {string} token
 * @returns {Promise<TokenValidationResult>}
 */
export async function validateBedrockToken(token) {
  const endpoint = process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME;

  if (!endpoint) {
    return {
      ok: false,
      reason: 'config',
      message: 'The AI gateway endpoint is not configured on the server.',
    };
  }

  let response;
  try {
    response = await fetch(`${endpoint}/model/${MODEL_ID}/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
      }),
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      message: `Could not reach the AI gateway (${err.message}). Check your connection and try again.`,
    };
  }

  if (response.ok) {
    return { ok: true };
  }

  const body = await response.text().catch(() => '');

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: 'auth',
      status: response.status,
      message: 'That token was rejected by the AI gateway. Double-check you copied it correctly, or generate a new one.',
    };
  }

  if (response.status === 429) {
    return {
      ok: false,
      reason: 'rate_limit',
      status: response.status,
      message: 'The AI gateway is rate-limiting requests right now. Wait a moment and try again.',
    };
  }

  if (response.status >= 500) {
    return {
      ok: false,
      reason: 'server',
      status: response.status,
      message: `The AI gateway returned a server error (${response.status}). This looks like a gateway issue, not your token — try again shortly.`,
    };
  }

  return {
    ok: false,
    reason: 'unknown',
    status: response.status,
    message: `The AI gateway returned an unexpected response (${response.status}): ${body.slice(0, 200)}`,
  };
}

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

Provide only the summary text, no preamble. Write plain prose. You may use **bold** to emphasize key terms, but do not use any other markdown formatting (no headings, italics, bullet lists, tables, or links).`;

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
