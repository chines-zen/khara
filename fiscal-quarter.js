/**
 * Fiscal quarter math for a fiscal year that starts in February.
 * Q1 = Feb-Apr, Q2 = May-Jul, Q3 = Aug-Oct, Q4 = Nov-Jan.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// abs-month = year*12 + month (0-indexed month), giving a single monotonic
// integer so quarter/year boundaries can be computed with plain arithmetic
// and floor/modulo, without any Date-object month-rollover edge cases.
function quarterStartAbsMonth(referenceDate) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed, Jan = 0
  const offset = (((month - 1) % 3) + 3) % 3;
  return year * 12 + month - offset;
}

function absMonthToYearMonth(absMonth) {
  return [Math.floor(absMonth / 12), ((absMonth % 12) + 12) % 12];
}

/**
 * Returns the default close-date scoping window: the fiscal quarter before the
 * current one through the fiscal quarter after it (a rolling 9-month window).
 * @param {Date} referenceDate
 * @returns {{ from: string, to: string }} ISO dates (YYYY-MM-DD)
 */
export function getDefaultCloseDateRange(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed, Jan = 0

  // Fiscal quarters start on Feb(1), May(4), Aug(7), Nov(10) — these are the
  // only calendar months where (month - 1) % 3 === 0, and since 12 % 3 === 0
  // that congruence holds regardless of year, so no year-wrap special-casing
  // is needed here.
  const offset = (((month - 1) % 3) + 3) % 3;
  const absMonth = year * 12 + month;
  const currentQuarterStartAbsMonth = absMonth - offset;

  const previousQuarterStartAbsMonth = currentQuarterStartAbsMonth - 3;
  const nextQuarterLastAbsMonth = currentQuarterStartAbsMonth + 5; // last month of the next quarter

  const fromYear = Math.floor(previousQuarterStartAbsMonth / 12);
  const fromMonth = ((previousQuarterStartAbsMonth % 12) + 12) % 12;

  const toYear = Math.floor(nextQuarterLastAbsMonth / 12);
  const toMonth = ((nextQuarterLastAbsMonth % 12) + 12) % 12;

  return {
    from: formatDate(fromYear, fromMonth, 1),
    to: formatDate(toYear, toMonth, lastDayOfMonth(toYear, toMonth)),
  };
}

/**
 * Returns just the current fiscal quarter (3 months).
 * @param {Date} referenceDate
 * @returns {{ from: string, to: string }} ISO dates (YYYY-MM-DD)
 */
export function getCurrentQuarterRange(referenceDate = new Date()) {
  const qStartAbs = quarterStartAbsMonth(referenceDate);
  const qEndAbs = qStartAbs + 2; // last month of the same (3-month) quarter

  const [fromYear, fromMonth] = absMonthToYearMonth(qStartAbs);
  const [toYear, toMonth] = absMonthToYearMonth(qEndAbs);

  return {
    from: formatDate(fromYear, fromMonth, 1),
    to: formatDate(toYear, toMonth, lastDayOfMonth(toYear, toMonth)),
  };
}

/**
 * Returns the current fiscal quarter through the end of the next one (6 months).
 * @param {Date} referenceDate
 * @returns {{ from: string, to: string }} ISO dates (YYYY-MM-DD)
 */
export function getCurrentAndNextQuarterRange(referenceDate = new Date()) {
  const qStartAbs = quarterStartAbsMonth(referenceDate);
  const rangeEndAbs = qStartAbs + 5; // last month of the next quarter

  const [fromYear, fromMonth] = absMonthToYearMonth(qStartAbs);
  const [toYear, toMonth] = absMonthToYearMonth(rangeEndAbs);

  return {
    from: formatDate(fromYear, fromMonth, 1),
    to: formatDate(toYear, toMonth, lastDayOfMonth(toYear, toMonth)),
  };
}

/**
 * Returns the full fiscal year (Feb-Jan) containing referenceDate.
 * @param {Date} referenceDate
 * @returns {{ from: string, to: string }} ISO dates (YYYY-MM-DD)
 */
export function getFiscalYearRange(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed, Jan = 0
  const absMonth = year * 12 + month;

  // Months elapsed since the fiscal year's start month (Feb = index 0);
  // (month - 1 + 12) % 12 handles Jan (month=0) wrapping back to 11,
  // i.e. Jan belongs to the fiscal year that started the previous Feb.
  const monthsSinceFyStart = ((month - 1) + 12) % 12;
  const fyStartAbs = absMonth - monthsSinceFyStart;
  const fyEndAbs = fyStartAbs + 11; // fiscal year spans 12 months

  const [fromYear, fromMonth] = absMonthToYearMonth(fyStartAbs);
  const [toYear, toMonth] = absMonthToYearMonth(fyEndAbs);

  return {
    from: formatDate(fromYear, fromMonth, 1),
    to: formatDate(toYear, toMonth, lastDayOfMonth(toYear, toMonth)),
  };
}

/** @typedef {'current_quarter' | 'current_and_next_quarter' | 'fiscal_year' | 'custom'} CloseDatePreset */

export const DEFAULT_CLOSE_DATE_PRESET = 'fiscal_year';

/**
 * Infer the effective close-date preset for a saved (possibly legacy)
 * oppScopeSettings preference, without requiring a data migration.
 *
 * Legacy convention (rows saved before closeDatePreset existed):
 *   - closeDateFrom/closeDateTo both null      -> old "recommended range" checkbox was ON
 *   - closeDateFrom/closeDateTo both non-null  -> old "recommended range" checkbox was OFF (custom)
 * New rows always set closeDatePreset explicitly and this just echoes it back.
 * @param {{ closeDatePreset?: CloseDatePreset, closeDateFrom?: string | null, closeDateTo?: string | null } | null | undefined} saved
 * @returns {CloseDatePreset}
 */
export function resolveCloseDatePreset(saved) {
  if (!saved) return DEFAULT_CLOSE_DATE_PRESET;
  if (saved.closeDatePreset) return saved.closeDatePreset;
  if (saved.closeDateFrom && saved.closeDateTo) return 'custom';
  return DEFAULT_CLOSE_DATE_PRESET;
}

/**
 * Resolve a preset (or literal custom dates) to a concrete { from, to } range
 * using referenceDate as "today" — the three named presets are always
 * recomputed live, never frozen at save time.
 * @param {CloseDatePreset} preset
 * @param {string | null} literalFrom - only used when preset === 'custom'
 * @param {string | null} literalTo - only used when preset === 'custom'
 * @param {Date} referenceDate
 * @returns {{ from: string, to: string }} ISO dates (YYYY-MM-DD)
 */
export function resolveCloseDateRange(preset, literalFrom, literalTo, referenceDate = new Date()) {
  switch (preset) {
    case 'current_quarter':
      return getCurrentQuarterRange(referenceDate);
    case 'fiscal_year':
      return getFiscalYearRange(referenceDate);
    case 'custom':
      if (literalFrom && literalTo) return { from: literalFrom, to: literalTo };
      return getCurrentAndNextQuarterRange(referenceDate);
    case 'current_and_next_quarter':
    default:
      return getCurrentAndNextQuarterRange(referenceDate);
  }
}
