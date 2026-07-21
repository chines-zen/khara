import { getUserPreference } from './preferences.js';
import { getDefaultCloseDateRange } from '../fiscal-quarter.js';

export const DEFAULT_ARR_THRESHOLD = 50000;

const PREFERENCE_KEY = 'oppScopeSettings';

/**
 * Resolve the effective opportunity scope for a user: their saved ARR/close-date
 * preferences, falling back to computed defaults for anything unset.
 *
 * scEmails is manager-only (see the "Sales Engineers" Settings field) and is
 * returned as saved here without checking the caller's manager status — callers
 * must scrub it to [] for non-managers before using it in a query.
 * @param {number} userId
 * @returns {Promise<{ arrThreshold: number, closeDateFrom: string, closeDateTo: string, scEmails: string[] }>}
 */
export async function getEffectiveOppScope(userId) {
  const saved = await getUserPreference(userId, PREFERENCE_KEY);
  const defaultRange = getDefaultCloseDateRange();

  return {
    arrThreshold: saved?.arrThreshold ?? DEFAULT_ARR_THRESHOLD,
    closeDateFrom: saved?.closeDateFrom ?? defaultRange.from,
    closeDateTo: saved?.closeDateTo ?? defaultRange.to,
    scEmails: Array.isArray(saved?.scEmails) ? saved.scEmails : [],
  };
}
