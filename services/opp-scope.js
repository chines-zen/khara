import { pool } from '../db/index.js';
import { getUserPreference } from './preferences.js';
import { DEFAULT_CLOSE_DATE_PRESET, resolveCloseDatePreset, resolveCloseDateRange } from '../fiscal-quarter.js';

export const DEFAULT_ARR_THRESHOLD = 12000;

const PREFERENCE_KEY = 'oppScopeSettings';

/**
 * Seed a user's default opportunity scope preference (ARR threshold + fiscal-year
 * close-date preset) when they're first created. Uses ON CONFLICT DO NOTHING so a
 * user's deliberate changes are never overwritten — this only fills in the default
 * when no row exists yet. scEmails stays empty: it's manager-only and configured
 * later in Settings (the manager scope gate still routes managers there).
 *
 * Without this row the opportunities page treats a missing preference as
 * "not set up" and force-navigates the user to Settings.
 */
export async function ensureDefaultOppScope(userId) {
  const defaults = {
    arrThreshold: DEFAULT_ARR_THRESHOLD,
    closeDatePreset: DEFAULT_CLOSE_DATE_PRESET,
    closeDateFrom: null,
    closeDateTo: null,
    scEmails: [],
  };

  await pool.query(
    `INSERT INTO user_preferences (user_id, preference_key, preference_value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, preference_key) DO NOTHING`,
    [userId, PREFERENCE_KEY, JSON.stringify(defaults)]
  );
}

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
 * @returns {Promise<{ arrThreshold: number, closeDatePreset: import('../fiscal-quarter.js').CloseDatePreset, closeDateFrom: string, closeDateTo: string, scEmails: string[] }>}
 */
export async function getEffectiveOppScope(userId) {
  const saved = await getUserPreference(userId, PREFERENCE_KEY);

  const preset = resolveCloseDatePreset(saved);
  const range = resolveCloseDateRange(preset, saved?.closeDateFrom ?? null, saved?.closeDateTo ?? null);

  return {
    arrThreshold: saved?.arrThreshold ?? DEFAULT_ARR_THRESHOLD,
    closeDatePreset: preset,
    closeDateFrom: range.from,
    closeDateTo: range.to,
    scEmails: Array.isArray(saved?.scEmails) ? saved.scEmails : [],
  };
}
