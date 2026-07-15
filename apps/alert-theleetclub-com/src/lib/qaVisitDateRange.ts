/** Shared default date range for QA Visit tab + modal — Asia/Kuwait calendar days. */

function kuwaitParts(d = new Date()): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { y: get('year'), m: get('month'), day: get('day') };
}

function kuwaitIsoFromParts(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Today as YYYY-MM-DD in Asia/Kuwait (not browser/UTC). */
export function qaTodayIso(): string {
  const { y, m, day } = kuwaitParts();
  return kuwaitIsoFromParts(y, m, day);
}

/** From-date = Kuwait today minus ~90 days (lighter default SC scan). */
export function qaDefaultFromDate(): string {
  const { y, m, day } = kuwaitParts();
  const utcNoon = new Date(Date.UTC(y, m - 1, day, 9, 0, 0));
  utcNoon.setUTCDate(utcNoon.getUTCDate() - 90);
  const p = kuwaitParts(utcNoon);
  return kuwaitIsoFromParts(p.y, p.m, p.day);
}

export function qaDateRangeFromSearchParams(params: URLSearchParams): { from: string; to: string } {
  const from = (params.get('from') || '').trim() || qaDefaultFromDate();
  const to = (params.get('to') || '').trim() || qaTodayIso();
  return { from, to };
}
