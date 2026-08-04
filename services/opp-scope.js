import { pool } from '../db/index.js';
import { getUserPreference, setUserPreference } from './preferences.js';
import { resolveScUserIds } from './sc-lookup.js';
import { DEFAULT_CLOSE_DATE_PRESET, resolveCloseDatePreset, resolveCloseDateRange } from '../fiscal-quarter.js';

export const DEFAULT_ARR_THRESHOLD = 12000;

const PREFERENCE_KEY = 'oppScopeSettings';
const BLIND_SPOTS_PREFERENCE_KEY = 'blindSpotsSettings';

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

  // Seed Blind Spots independently from the main opportunity scope so the
  // first unified sync always has an explicit, intentional scope. This is
  // idempotent and never overwrites a user's later Blind Spots settings.
  const blindSpotsDefaults = {
    ownerEmails: [],
    arrThreshold: DEFAULT_ARR_THRESHOLD,
    closeDatePreset: DEFAULT_CLOSE_DATE_PRESET,
    closeDateFrom: null,
    closeDateTo: null,
  };

  await pool.query(
    `INSERT INTO user_preferences (user_id, preference_key, preference_value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, preference_key) DO NOTHING`,
    [userId, BLIND_SPOTS_PREFERENCE_KEY, JSON.stringify(blindSpotsDefaults)]
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

  const scEmails = Array.isArray(saved?.scEmails) ? saved.scEmails : [];

  return {
    arrThreshold: saved?.arrThreshold ?? DEFAULT_ARR_THRESHOLD,
    closeDatePreset: preset,
    closeDateFrom: range.from,
    closeDateTo: range.to,
    scEmails,
    // USER_IDs cached from a previous resolution of exactly this email set (see
    // resolveScopeUserIds). Empty when unresolved or when the emails changed,
    // in which case the caller falls back to a live USER_HISTORY lookup.
    scUserIds: matchesCachedEmails(saved, scEmails) ? saved.scUserIds : [],
  };
}

/** Resolve the independent individual-SC Blind Spots scope. */
export async function getEffectiveBlindSpotsScope(userId) {
  const saved = await getUserPreference(userId, BLIND_SPOTS_PREFERENCE_KEY);
  const preset = resolveCloseDatePreset(saved);
  const range = resolveCloseDateRange(
    preset,
    saved?.closeDateFrom ?? null,
    saved?.closeDateTo ?? null,
  );

  return {
    ownerEmails: Array.isArray(saved?.ownerEmails) ? saved.ownerEmails : [],
    arrThreshold: saved?.arrThreshold ?? DEFAULT_ARR_THRESHOLD,
    closeDatePreset: preset,
    closeDateFrom: range.from,
    closeDateTo: range.to,
  };
}

/**
 * Whether a saved scope's cached scUserIds were resolved from the same email set
 * it currently holds. Order-insensitive, mirroring the frontend's scopeSignature.
 */
function matchesCachedEmails(saved, scEmails) {
  if (!Array.isArray(saved?.scUserIds) || saved.scUserIds.length === 0) {
    return false;
  }
  if (!Array.isArray(saved?.scUserIdsFor)) {
    return false;
  }
  const a = [...saved.scUserIdsFor].map((e) => e.toLowerCase()).sort();
  const b = [...scEmails].map((e) => e.toLowerCase()).sort();
  return a.length === b.length && a.every((email, i) => email === b[i]);
}

/**
 * Resolve a manager's Sales Engineer emails to Snowflake USER_IDs and cache them
 * on the saved scope preference, so the opportunity/activity refresh paths don't
 * re-query USER_HISTORY on every cache miss.
 *
 * Called when a manager saves their SE list (see routes/preferences.js), which is
 * also where an unresolvable email becomes visible: the returned counts let the
 * UI report "3 of 4 emails matched" instead of silently dropping the typo.
 *
 * Only successful resolutions are cached. Emails that don't resolve — a typo, or
 * a new hire without a USER_HISTORY record yet — are left out of scUserIdsFor, so
 * the next save (or refresh) retries them rather than caching them as absent.
 *
 * @param {number} userId
 * @param {string} requestingEmail - identity to run the Snowflake query as
 * @returns {Promise<{ requested: number, resolved: number, unresolved: string[] }>}
 */
export async function resolveScopeUserIds(userId, requestingEmail) {
  const saved = await getUserPreference(userId, PREFERENCE_KEY);
  const scEmails = Array.isArray(saved?.scEmails) ? saved.scEmails : [];

  if (scEmails.length === 0) {
    return { requested: 0, resolved: 0, unresolved: [] };
  }

  const resolved = await resolveScUserIds(scEmails, requestingEmail);

  // resolveScUserIds returns only USER_IDs, not which email produced each one,
  // so a partial result can't be attributed back to specific emails. Cache the
  // full email set only when every email resolved; otherwise cache nothing and
  // let the refresh path do a live lookup, which stays correct either way.
  const allResolved = resolved.length === scEmails.length;

  await setUserPreference(userId, PREFERENCE_KEY, {
    ...saved,
    scUserIds: allResolved ? resolved : [],
    scUserIdsFor: allResolved ? scEmails : [],
  });

  return {
    requested: scEmails.length,
    resolved: resolved.length,
    unresolved: allResolved ? [] : scEmails,
  };
}
