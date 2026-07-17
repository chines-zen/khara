// Fixed opportunity set for local dev (USE_TEST_OPPS=true) — bypasses SC identity,
// stage, and ARR/close-date scoping so the same known opportunities load every time.
// Salesforce IDs resolved from their 15-char form to the 18-char CRM_OPPORTUNITY_ID.
export const TEST_OPP_IDS = [
  '006PC00000ZpxxxYAB', // Melio | AR's
  '006PC00000ZmLNnYAN', // Willkie | Upgrade & Consolidate to Suite Enterprise, AI Agents & Copilot
  '006PC00000XXrU0YAL', // Acme | AI Agents & Premier
  '006PC00000W3pzeYAB', // RWS | New Team (Suite Enterprise- 50)
  '006PC00000aZkeOYAS', // Willkie Farr & LLP Renewal
  '006PC00000agl93YAA', // Informa Techtarget l R&R (250 Agents)
  '006PC00000WBQWDYA5', // Black Duck Software l AIA, AI Expert, Copilot (75)
];

export function isTestOppsEnabled() {
  return process.env.USE_TEST_OPPS === 'true';
}
