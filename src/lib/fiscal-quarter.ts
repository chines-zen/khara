/**
 * Fiscal quarter math for a fiscal year that starts in February.
 * Q1 = Feb-Apr, Q2 = May-Jul, Q3 = Aug-Oct, Q4 = Nov-Jan.
 *
 * Mirrors fiscal-quarter.js on the server; used only to display the computed
 * default range in the UI — actual filtering always happens server-side.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getDefaultCloseDateRange(referenceDate: Date = new Date()): {
  from: string;
  to: string;
} {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed, Jan = 0

  const offset = (((month - 1) % 3) + 3) % 3;
  const absMonth = year * 12 + month;
  const currentQuarterStartAbsMonth = absMonth - offset;

  const previousQuarterStartAbsMonth = currentQuarterStartAbsMonth - 3;
  const nextQuarterLastAbsMonth = currentQuarterStartAbsMonth + 5;

  const fromYear = Math.floor(previousQuarterStartAbsMonth / 12);
  const fromMonth = ((previousQuarterStartAbsMonth % 12) + 12) % 12;

  const toYear = Math.floor(nextQuarterLastAbsMonth / 12);
  const toMonth = ((nextQuarterLastAbsMonth % 12) + 12) % 12;

  return {
    from: formatDate(fromYear, fromMonth, 1),
    to: formatDate(toYear, toMonth, lastDayOfMonth(toYear, toMonth)),
  };
}
