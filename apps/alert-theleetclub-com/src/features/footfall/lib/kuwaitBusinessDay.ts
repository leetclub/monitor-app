/** Kuwait calendar helpers — business week Sun–Thu only. */

const TZ = 'Asia/Kuwait';

export function kuwaitYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

export function kuwaitWeekdayShort(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
}

/** True for Sun–Thu in Kuwait. */
export function isKuwaitBusinessDay(d: Date = new Date()): boolean {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(kuwaitWeekdayShort(d));
}

/** Last Sun–Thu on or before `d` (walk back skipping Fri/Sat). */
export function lastKuwaitBusinessYmd(d: Date = new Date()): string {
  const cur = new Date(d);
  for (let i = 0; i < 7; i++) {
    if (isKuwaitBusinessDay(cur)) return kuwaitYmd(cur);
    cur.setDate(cur.getDate() - 1);
  }
  return kuwaitYmd(d);
}

export function formatAccessDayBanner(ymd: string): string {
  const [y, m, day] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
  }).format(dt);
  const longDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dt);
  return `${weekday} · ${longDate}`;
}

export function ymdToKuwaitDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Calendar week starts Sunday (Kuwait timezone) for a YYYY-MM-DD day. */
export function kuwaitSundayWeekStartForYmd(ymd: string): string {
  return kuwaitSundayWeekStartYmd(ymdToKuwaitDate(ymd));
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Saturday ending the calendar week that contains `ymd`. */
export function kuwaitSundayWeekEndForYmd(ymd: string): string {
  return addDaysYmd(kuwaitSundayWeekStartForYmd(ymd), 6);
}

/**
 * Inclusive end date for “% rev / week” — same for every day in that week.
 * Past weeks: full Sun–Sat. Current week: Sun through Kuwait today.
 */
export function weekRevenuePeriodEndYmd(
  selectedYmd: string,
  todayYmd: string = kuwaitYmd(),
): string {
  const weekStart = kuwaitSundayWeekStartForYmd(selectedYmd);
  const currentWeekStart = kuwaitSundayWeekStartForYmd(todayYmd);
  if (weekStart < currentWeekStart) {
    return kuwaitSundayWeekEndForYmd(selectedYmd);
  }
  return todayYmd;
}

/** Calendar week starts Sunday (Kuwait timezone). */
export function kuwaitSundayWeekStartYmd(now: Date = new Date()): string {
  const ymd = kuwaitYmd(now);
  const [y, m, d] = ymd.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
  }).format(base);
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  const offset = idx >= 0 ? idx : 0;
  base.setUTCDate(base.getUTCDate() - offset);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Inclusive Sun–Thu business days between two YYYY-MM-DD dates. */
export function kuwaitBusinessDaysInRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let cur = startYmd;
  while (cur <= endYmd) {
    if (isKuwaitBusinessDay(ymdToKuwaitDate(cur))) out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

/** Short axis label, e.g. "Sun 8 Jun". */
export function formatShortBusinessDay(ymd: string): string {
  const dt = ymdToKuwaitDate(ymd);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(dt);
  const rest = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  }).format(dt);
  return `${weekday} ${rest}`;
}

export function kuwaitBusinessContext(now: Date = new Date()): {
  salesYmd: string;
  isLiveBusinessDay: boolean;
  banner: string;
} {
  const live = isKuwaitBusinessDay(now);
  const salesYmd = live ? kuwaitYmd(now) : lastKuwaitBusinessYmd(now);
  const banner = formatAccessDayBanner(salesYmd);
  return { salesYmd, isLiveBusinessDay: live, banner };
}
