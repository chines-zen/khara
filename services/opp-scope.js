import { getUserPreference } from './preferences.js';
import { resolveCloseDatePreset, resolveCloseDateRange } from '../fiscal-quarter.js';

export const DEFAULT_ARR_THRESHOLD = 50000;

const PREFERENCE_KEY = 'oppScopeSettings';

/**
 * Resolve the effective opportunity scope for a user: their saved ARR/close-date
 * preferences, falling back to computed defaults for anything unset.
 *
 * closeDateFrom/closeDateTo are always resolved fresh from the saved (or
 * inferred) preset using today's date — the three named presets are never
 * frozen at save time; only "custom" returns the user's literal saved dates.
 *
 * scEmails is manager-only (see the "Sales Engineers" Settings field) and is
 * returned as saved here without checking the caller's manager status — callers
 * must scrub it to [] for non-managers before using it in a query.
 * @param {number} userId
 * @returns {Promise<{ arrThreshold: number, closeDateFrom: string, closeDateTo: string, scEmails: string[] }>}
 */
export async function getEffectiveOppScope(userId) {
  const saved = await getUserPreference(userId, PREFERENCE_KEY);

  const preset = resolveCloseDatePreset(saved);
  const range = resolveCloseDateRange(preset, saved?.closeDateFrom ?? null, saved?.closeDateTo ?? null);

  return {
    arrThreshold: saved?.arrThreshold ?? DEFAULT_ARR_THRESHOLD,
    closeDateFrom: range.from,
    closeDateTo: range.to,
    scEmails: Array.isArray(saved?.scEmails) ? saved.scEmails : [],
  };
}
