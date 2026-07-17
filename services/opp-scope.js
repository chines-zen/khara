import { getUserPreference } from './preferences.js';
import { getDefaultCloseDateRange } from '../fiscal-quarter.js';

export const DEFAULT_ARR_THRESHOLD = 50000;

const PREFERENCE_KEY = 'oppScopeSettings';

/**
 * Resolve the effective opportunity scope for a user: their saved ARR/close-date
 * preferences, falling back to computed defaults for anything unset.
 * @param {number} userId
 * @returns {Promise<{ arrThreshold: number, closeDateFrom: string, closeDateTo: string }>}
 */
export async function getEffectiveOppScope(userId) {
  const saved = await getUserPreference(userId, PREFERENCE_KEY);
  const defaultRange = getDefaultCloseDateRange();

  return {
    arrThreshold: saved?.arrThreshold ?? DEFAULT_ARR_THRESHOLD,
    closeDateFrom: saved?.closeDateFrom ?? defaultRange.from,
    closeDateTo: saved?.closeDateTo ?? defaultRange.to,
  };
}
