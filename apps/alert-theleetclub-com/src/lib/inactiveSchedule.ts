/** Alert Admin inactive schedule (Sun=0 … Sat=6). */

export type InactiveRange = { start: string; end: string };

export type InactiveSchedule = {
  weekdays: number[];
  dates: string[];
  ranges: InactiveRange[];
};

export function emptyInactiveSchedule(): InactiveSchedule {
  return { weekdays: [], dates: [], ranges: [] };
}

export function normalizeInactiveSchedule(raw: unknown): InactiveSchedule {
  if (!raw || typeof raw !== 'object') return emptyInactiveSchedule();
  const o = raw as Record<string, unknown>;
  const weekdays = Array.isArray(o.weekdays)
    ? [...new Set(o.weekdays.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 6))].sort(
        (a, b) => a - b,
      )
    : [];
  const dates = Array.isArray(o.dates)
    ? [...new Set(o.dates.map((d) => String(d ?? '').trim().slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
    : [];
  const ranges: InactiveRange[] = [];
  if (Array.isArray(o.ranges)) {
    for (const r of o.ranges) {
      if (!r || typeof r !== 'object') continue;
      const rr = r as Record<string, unknown>;
      const start = String(rr.start ?? '').trim().slice(0, 10);
      const end = String(rr.end ?? '').trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end) {
        ranges.push({ start, end });
      }
    }
  }
  return { weekdays, dates, ranges };
}
