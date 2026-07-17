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
