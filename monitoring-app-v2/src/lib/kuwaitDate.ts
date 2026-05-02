/** Kuwait calendar date utilities (YYYY-MM-DD). */

/** Calendar date (YYYY-MM-DD) in Asia/Kuwait. */
export function kuwaitDateISO(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${day}`;
}

export function kuwaitTodayISO(): string {
  return kuwaitDateISO(new Date());
}

export function kuwaitYesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return kuwaitDateISO(d);
}

