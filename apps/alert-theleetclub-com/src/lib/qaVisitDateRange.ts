/** Shared default date range for QA Visit tab + modal (1 year → today, Kuwait-agnostic ISO dates). */

export function qaDefaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 180);
  return d.toISOString().slice(0, 10);
}

export function qaTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function qaDateRangeFromSearchParams(params: URLSearchParams): { from: string; to: string } {
  const from = (params.get('from') || '').trim() || qaDefaultFromDate();
  const to = (params.get('to') || '').trim() || qaTodayIso();
  return { from, to };
}
