import type { ReportQuery } from './types';

/** Sun–Thu business week (5 days), aligned with server warm windows. */
export type BusinessWeek = {
  startDate: string;
  endDate: string;
  label: string;
  /** Short chip label e.g. "Jun 8" */
  shortLabel: string;
};

function parseUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = parseUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIso(d);
}

/** Sunday on or before `iso` (UTC). */
export function sundayOnOrBefore(iso: string): string {
  const d = parseUtc(iso);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - dow);
  return formatIso(d);
}

/** Sun–Thu window containing `iso`. */
export function businessWeekForDate(iso: string): BusinessWeek {
  const start = sundayOnOrBefore(iso);
  const end = addDays(start, 4);
  return weekLabel(start, end);
}

export function weekLabel(startDate: string, endDate: string): BusinessWeek {
  const start = parseUtc(startDate);
  const end = parseUtc(endDate);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const year = start.getUTCFullYear();
  return {
    startDate,
    endDate,
    label: `${fmt(start)}–${fmt(end)}, ${year} (Sun–Thu)`,
    shortLabel: fmt(start),
  };
}

/** Step weekly Sun–Thu windows from anchor through end (matches server warm). */
export function weeklySunThuWindows(
  anchorStart: string,
  throughIso: string,
  windowLen = 5,
): BusinessWeek[] {
  const out: BusinessWeek[] = [];
  let cur = anchorStart;
  const endBound = parseUtc(throughIso);
  while (parseUtc(cur) <= endBound) {
    const windowEnd = addDays(cur, windowLen - 1);
    if (parseUtc(windowEnd) <= endBound) {
      out.push(weekLabel(cur, windowEnd));
    }
    cur = addDays(cur, 7);
  }
  return out;
}

export function toReportQuery(
  week: Pick<BusinessWeek, 'startDate' | 'endDate'>,
  base?: Partial<ReportQuery>,
): ReportQuery {
  return {
    startDate: week.startDate,
    endDate: week.endDate,
    enableCompare: base?.enableCompare ?? false,
    compareStartDate: base?.compareStartDate,
    compareEndDate: base?.compareEndDate,
  };
}

export function queriesEqual(a: ReportQuery, b: ReportQuery): boolean {
  return (
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    a.enableCompare === b.enableCompare &&
    (a.compareStartDate || '') === (b.compareStartDate || '') &&
    (a.compareEndDate || '') === (b.compareEndDate || '')
  );
}

const todayIso = () => formatIso(new Date());

/** Featured + recent weeks for quick pick (newest first). */
export function buildWeekCatalog(maxRecent = 24): {
  featured: BusinessWeek[];
  recent: BusinessWeek[];
} {
  const all = weeklySunThuWindows('2026-05-10', todayIso());
  const featuredStarts = new Set(['2026-05-10']);
  const featured = all.filter((w) => featuredStarts.has(w.startDate));
  const recent = [...all].reverse().slice(0, maxRecent);
  return { featured, recent };
}

export function shiftWeek(startDate: string, weeks: number): BusinessWeek {
  const start = addDays(startDate, weeks * 7);
  return businessWeekForDate(start);
}

export function compareWeekBefore(primaryStart: string): BusinessWeek {
  return shiftWeek(primaryStart, -1);
}

export function formatWeekRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}
