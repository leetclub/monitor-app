/** Kuwait elapsed-window sales (today so far vs yesterday same clock time). */

export type SalesElapsedDay = {
  date: string;
  weekday?: string;
  kwd: number;
  /** True when Vendon page cap was hit for this day's window — totals may be understated. */
  incomplete?: boolean;
};

export type SalesElapsedRow = {
  todayKwd?: number;
  yesterdaySameElapsedKwd?: number;
  /** Full Kuwait calendar day yesterday (midnight → end of day), not same-clock elapsed. */
  yesterdayFullDayKwd?: number;
  yesterdayFullDayIncomplete?: boolean;
  /** Full Kuwait calendar day for day-before-yesterday (revenue cache). */
  dayBeforeFullDayKwd?: number;
  trendPct?: number | null;
  dailyElapsed?: SalesElapsedDay[];
};

export type DailySalesElapsedResponse = {
  timezone?: string;
  today?: string;
  yesterday?: string;
  historyDays?: number;
  historyDates?: string[];
  asOfLocal?: string;
  comparisonNote?: string;
  /** Fleet sum — full Kuwait calendar day yesterday (from revenue cache). */
  fleetYesterdayFullDayKwd?: number;
  /** Fleet sum — full Kuwait calendar day day-before-yesterday (from revenue cache). */
  fleetDayBeforeFullDayKwd?: number;
  /** Fleet sum — today elapsed (same-clock window). */
  fleetTodayKwd?: number;
  /** Fleet sum — yesterday same elapsed clock. */
  fleetYesterdaySameElapsedKwd?: number;
  error?: string;
  fromCache?: boolean;
  stale?: boolean;
  cacheGeneratedAt?: string;
  cacheBucket?: string;
  /** Fleet machine ids included in byMachineId (matches Vendon fleet list). */
  allowedMachineIds?: string[];
  byMachineId?: Record<string, SalesElapsedRow>;
};

/** Kuwait calendar ISO date minus N days (no UTC drift). */
export function kuwaitIsoDateMinusDays(isoDate: string, days: number): string | null {
  const t = String(isoDate ?? '').trim();
  const parts = t.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function salesDayKwd(row: SalesElapsedRow | undefined, dayIndex: number): number | null {
  const days = row?.dailyElapsed;
  if (days && days.length > dayIndex) {
    const k = days[dayIndex]?.kwd;
    if (k == null || !Number.isFinite(Number(k))) return null;
    return Number(k);
  }
  if (dayIndex === 0 && row?.todayKwd != null && Number.isFinite(Number(row.todayKwd))) {
    return Number(row.todayKwd);
  }
  if (dayIndex === 1 && row?.yesterdaySameElapsedKwd != null && Number.isFinite(Number(row.yesterdaySameElapsedKwd))) {
    return Number(row.yesterdaySameElapsedKwd);
  }
  return null;
}

export function yesterdayVsDayBeforeSales(row: SalesElapsedRow | undefined): {
  yesterdayKwd: number | null;
  dayBeforeKwd: number | null;
  trendPct: number | null;
  yesterdayDate?: string;
  dayBeforeDate?: string;
} {
  const yesterdayKwd = salesDayKwd(row, 1);
  const dayBeforeKwd = salesDayKwd(row, 2);
  let trendPct: number | null = null;
  if (yesterdayKwd != null && dayBeforeKwd != null && dayBeforeKwd > 0) {
    trendPct = salesTrendFromToday(yesterdayKwd, dayBeforeKwd);
  }
  const days = row?.dailyElapsed;
  return {
    yesterdayKwd,
    dayBeforeKwd,
    trendPct,
    yesterdayDate: days?.[1]?.date,
    dayBeforeDate: days?.[2]?.date,
  };
}

export function formatKwd(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `${x.toFixed(2)} KD`;
}

/** Same as formatKwd — kept for call sites that prefer the name. */
export function formatKdCompact(x: number): string {
  return formatKwd(x);
}

export function formatSalesTrendPct(pct: number): string {
  if (!Number.isFinite(pct)) return '';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** Green / red for positive / negative day-over-day change. */
export function salesTrendColor(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct === 0) return '#94a3b8';
  return pct > 0 ? '#53e16f' : '#ff3b30';
}

/** Plain text: ▲ +28% / ▼ -4.2% */
export function formatSalesTrendArrow(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return `${arrow} ${formatSalesTrendPct(pct)}`;
}

/** Colored HTML for chart tooltips — prefix e.g. "day" → `day Δ ▲ +28%` */
export function formatSalesTrendHtml(pct: number, prefix = 'day'): string {
  if (!Number.isFinite(pct)) return '';
  const color = salesTrendColor(pct);
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return `<span style="color:${color};font-weight:600">${prefix} <span style="color:${color}">Δ</span> ${arrow} ${formatSalesTrendPct(pct)}</span>`;
}

export function salesElapsedForMachine(
  data: DailySalesElapsedResponse | undefined,
  machineId: string,
  _isSuccess = false,
): SalesElapsedRow | undefined {
  const raw = data?.byMachineId?.[machineId];
  if (raw) return raw;
  return undefined;
}

export function canOpenSalesHistory(row: SalesElapsedRow | undefined): boolean {
  if (!row) return false;
  if (row.dailyElapsed?.length) return true;
  return typeof row.todayKwd === 'number' && Number.isFinite(row.todayKwd);
}

export function salesComparisonCaption(asOfLocal?: string | null): string {
  if (!asOfLocal) {
    return 'Today (Kuwait) through page load vs each prior day over the same elapsed clock window.';
  }
  return `Today through ${asOfLocal.replace('T', ' ')} KWT vs each prior day over the same elapsed window.`;
}

export function salesTrendFromToday(todayKwd: number, priorKwd: number): number | null {
  if (!Number.isFinite(todayKwd) || !Number.isFinite(priorKwd)) return null;
  if (priorKwd <= 0) {
    if (todayKwd > 0) return 100;
    if (todayKwd === 0) return 0;
    return null;
  }
  return ((todayKwd - priorKwd) / priorKwd) * 100;
}

/** Prefer API trend when meaningful; otherwise derive from primary vs baseline (incl. baseline = 0). */
export function resolveSalesTrendPct(
  trendPct: number | null | undefined,
  primary: number | null | undefined,
  baseline: number | null | undefined,
): number | null {
  const canDerive =
    primary != null &&
    Number.isFinite(primary) &&
    baseline != null &&
    Number.isFinite(baseline);
  if (canDerive && baseline === 0) {
    return salesTrendFromToday(primary, baseline);
  }
  if (trendPct != null && Number.isFinite(Number(trendPct))) return Number(trendPct);
  if (canDerive) return salesTrendFromToday(primary, baseline);
  return null;
}

export type TodayVsDayComparison = {
  offsetDays: number;
  date: string;
  weekday?: string;
  priorKwd: number | null;
  /** When true, priorKwd may be missing/truncated — UI should prefer — over 0.00. */
  incomplete?: boolean;
  trendPct: number | null;
  compareLabel: string;
};

function elapsedDayKwd(d: SalesElapsedDay | undefined): number | null {
  if (!d) return null;
  if (d.incomplete && (d.kwd == null || Number(d.kwd) === 0)) return null;
  if (d.kwd == null || !Number.isFinite(Number(d.kwd))) return null;
  return Number(d.kwd);
}

/** Today vs yesterday, today vs 2 days ago, … — each prior day uses the same elapsed clock window. */
export function todayVsPriorDayComparisons(
  row: SalesElapsedRow,
  meta?: DailySalesElapsedResponse,
): { todayKwd: number; todayDate?: string; comparisons: TodayVsDayComparison[] } {
  const days =
    row.dailyElapsed && row.dailyElapsed.length > 0
      ? row.dailyElapsed
      : [
          ...(meta?.today && row.todayKwd != null && Number.isFinite(Number(row.todayKwd))
            ? [{ date: meta.today, weekday: 'Today', kwd: Number(row.todayKwd) }]
            : []),
          ...(meta?.yesterday &&
          row.yesterdaySameElapsedKwd != null &&
          Number.isFinite(Number(row.yesterdaySameElapsedKwd))
            ? [{ date: meta.yesterday, weekday: 'Yest', kwd: Number(row.yesterdaySameElapsedKwd) }]
            : []),
        ];

  const todayKwd = elapsedDayKwd(days[0]) ?? (row.todayKwd != null ? Number(row.todayKwd) : 0);
  const todayDate = days[0]?.date ?? meta?.today;
  const comparisons: TodayVsDayComparison[] = [];

  for (let i = 1; i < days.length; i++) {
    const d = days[i];
    const priorKwd = elapsedDayKwd(d);
    const offsetDays = i;
    comparisons.push({
      offsetDays,
      date: d.date,
      weekday: d.weekday,
      priorKwd,
      incomplete: Boolean(d.incomplete),
      trendPct: priorKwd != null ? salesTrendFromToday(todayKwd, priorKwd) : null,
      compareLabel: offsetDays === 1 ? 'Yesterday' : `${offsetDays} days ago`,
    });
  }

  return { todayKwd, todayDate, comparisons };
}

export function salesComparisonDetail(
  todayKwd: number,
  priorKwd: number | null,
  trendPct: number | null,
  compareLabel: string,
): string {
  const priorText = priorKwd != null ? formatKwd(priorKwd) : '—';
  const pct =
    trendPct != null && Number.isFinite(trendPct)
      ? ` Trend ${formatSalesTrendPct(trendPct)} vs that day.`
      : '';
  return `Today ${formatKwd(todayKwd)} vs ${priorText} on ${compareLabel} (same Kuwait elapsed window).${pct}`;
}

export function formatSalesDayLabel(dateIso: string, weekday?: string): string {
  const parts = dateIso.split('-');
  if (parts.length !== 3) return dateIso;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  let wd = weekday;
  if (!wd) {
    try {
      wd = d.toLocaleDateString('en-GB', { weekday: 'short' });
    } catch {
      wd = '';
    }
  }
  const dm = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return wd ? `${wd} ${dm}` : dm;
}
