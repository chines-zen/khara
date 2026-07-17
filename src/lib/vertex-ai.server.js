import { VertexAI } from '@google-cloud/vertexai';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'it-ai-exploration';
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const MODEL_NAME = 'gemini-3-flash-preview'; // Fast model for summaries

const vertexAI = new VertexAI({
  project: PROJECT_ID,
  location: LOCATION,
});

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
 * Generate an AI summary for an opportunity
 * @param {SummaryRequest} opp
 * @returns {Promise<string>}
 */
export async function generateOpportunitySummary(opp) {
  const model = vertexAI.preview.getGenerativeModel({
    model: MODEL_NAME,
  });

  const prompt = `You are a sales operations analyst. Generate a concise 3-5 sentence summary of this sales opportunity. Focus on:
- Current status and key risks
- Stakeholder engagement and next steps
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

  const result = await model.generateContent(prompt);
  const response = result.response;
  return response.candidates[0].content.parts[0].text;
}
