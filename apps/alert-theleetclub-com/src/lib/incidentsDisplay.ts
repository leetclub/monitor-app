/** Kuwait elapsed-window combined incident load (Red Flags trend history). */

import type { RedAlertCompareMode } from '@/features/redflags/redAlertTypes';
import { formatSalesDayLabel, kuwaitIsoDateMinusDays } from '@/lib/salesDisplay';

export type IncidentsElapsedDay = {
  date: string;
  weekday?: string;
  hits: number;
};

export type IncidentsElapsedRow = {
  todayHits?: number;
  yesterdaySameElapsedHits?: number;
  trendPct?: number | null;
  dailyElapsed?: IncidentsElapsedDay[];
};

export type DailyIncidentsElapsedResponse = {
  timezone?: string;
  today?: string;
  yesterday?: string;
  historyDays?: number;
  historyDates?: string[];
  asOfLocal?: string;
  comparisonNote?: string;
  error?: string;
  byMachineId?: Record<string, IncidentsElapsedRow>;
};

export type IncidentSnapTrend = {
  happensWeek?: number | null;
  happenedLastWeekAlignedSlice?: number | null;
  happenedLastWeek?: number | null;
  happenedPctVsPriorWeek?: number | null;
  happensToday?: number | null;
  happenedSameDayLastWeek?: number | null;
  happenedPctVsSameDayLastWeek?: number | null;
  happenedYesterdaySameElapsed?: number | null;
  happenedPctVsYesterdaySameElapsed?: number | null;
  happenedDayBeforeSameElapsed?: number | null;
  happenedPctVsDayBefore?: number | null;
};

export function incidentsDayHits(row: IncidentsElapsedRow | undefined, dayIndex: number): number | null {
  const days = row?.dailyElapsed;
  if (days && days.length > dayIndex) {
    const h = days[dayIndex]?.hits;
    if (h == null || !Number.isFinite(Number(h))) return null;
    return Number(h);
  }
  if (dayIndex === 0 && row?.todayHits != null && Number.isFinite(Number(row.todayHits))) {
    return Number(row.todayHits);
  }
  if (dayIndex === 1 && row?.yesterdaySameElapsedHits != null && Number.isFinite(Number(row.yesterdaySameElapsedHits))) {
    return Number(row.yesterdaySameElapsedHits);
  }
  return null;
}

export function incidentsYesterdayVsDayBefore(row: IncidentsElapsedRow | undefined): {
  yesterdayHits: number | null;
  dayBeforeHits: number | null;
  trendPct: number | null;
} {
  let yesterdayHits = incidentsDayHits(row, 1);
  let dayBeforeHits = incidentsDayHits(row, 2);
  if (dayBeforeHits == null && row?.dailyElapsed?.length) {
    const yDate = row.dailyElapsed[1]?.date ?? row.dailyElapsed[0]?.date;
    if (yDate) {
      const dbIso = kuwaitIsoDateMinusDays(yDate, 1);
      if (dbIso) {
        const hit = row.dailyElapsed.find((d) => d.date === dbIso);
        if (hit && hit.hits != null && Number.isFinite(Number(hit.hits))) {
          dayBeforeHits = Number(hit.hits);
        }
      }
    }
  }
  if (yesterdayHits != null && dayBeforeHits == null) {
    dayBeforeHits = 0;
  }
  let trendPct: number | null = null;
  if (yesterdayHits != null && dayBeforeHits != null) {
    trendPct = incidentTrendFromToday(yesterdayHits, dayBeforeHits);
  }
  return { yesterdayHits, dayBeforeHits, trendPct };
}

/** Prefer API trend; otherwise derive from primary vs baseline incident counts. */
export function resolveIncidentTrendPct(
  trendPct: number | null | undefined,
  primary: number | null | undefined,
  baseline: number | null | undefined,
): number | null {
  if (trendPct != null && Number.isFinite(Number(trendPct))) return Number(trendPct);
  if (primary == null || baseline == null || !Number.isFinite(primary) || !Number.isFinite(baseline)) {
    return null;
  }
  return incidentTrendFromToday(primary, baseline);
}

export function formatIncidentHits(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n));
}

export function formatIncidentTrendPct(pct: number): string {
  if (!Number.isFinite(pct)) return '';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function incidentsElapsedForMachine(
  data: DailyIncidentsElapsedResponse | undefined,
  machineId: string,
  _isSuccess = false,
): IncidentsElapsedRow | undefined {
  const raw = data?.byMachineId?.[machineId];
  if (raw) return raw;
  return undefined;
}

/** Merge elapsed API row with Red Alert snapshot when API omitted this machine. */
export function resolveIncidentsRow(
  row: {
    happensToday?: number | null;
    happensWeek?: number | null;
    happenedYesterdaySameElapsed?: number | null;
    happenedPctVsYesterdaySameElapsed?: number | null;
    frequency?: {
      totalCriteriaHitsToday?: number | null;
      totalCriteriaHitsYesterdaySameElapsed?: number | null;
    };
  },
  apiRow: IncidentsElapsedRow | undefined,
): IncidentsElapsedRow | undefined {
  if (apiRow?.dailyElapsed?.length) return apiRow;

  const snapToday = row.happensToday ?? row.frequency?.totalCriteriaHitsToday;
  const snapY =
    row.happenedYesterdaySameElapsed ?? row.frequency?.totalCriteriaHitsYesterdaySameElapsed;

  if (apiRow) {
    const apiHasSignal =
      (apiRow.todayHits != null && Number(apiRow.todayHits) > 0) ||
      (apiRow.yesterdaySameElapsedHits != null && Number(apiRow.yesterdaySameElapsedHits) > 0) ||
      (apiRow.dailyElapsed?.length ?? 0) > 0;
    if (apiHasSignal) return apiRow;
  }

  const hasSnap =
    (snapToday != null && Number.isFinite(Number(snapToday))) ||
    (snapY != null && Number.isFinite(Number(snapY))) ||
    row.happensWeek != null;

  if (!apiRow && !hasSnap) return undefined;

  return {
    todayHits:
      apiRow?.todayHits != null
        ? apiRow.todayHits
        : snapToday != null && Number.isFinite(Number(snapToday))
          ? Number(snapToday)
          : undefined,
    yesterdaySameElapsedHits:
      apiRow?.yesterdaySameElapsedHits != null
        ? apiRow.yesterdaySameElapsedHits
        : snapY != null && Number.isFinite(Number(snapY))
          ? Number(snapY)
          : undefined,
    trendPct: apiRow?.trendPct ?? row.happenedPctVsYesterdaySameElapsed ?? null,
    dailyElapsed: apiRow?.dailyElapsed,
  };
}

/** True when trend history popup can show snapshot and/or elapsed data. */
export function canOpenIncidentHistory(
  incidentsRow: IncidentsElapsedRow | undefined,
  snap?: IncidentSnapTrend,
): boolean {
  if (incidentsRow?.dailyElapsed?.length) return true;
  if (incidentsRow?.todayHits != null && Number.isFinite(Number(incidentsRow.todayHits))) return true;
  if (snap?.happensWeek != null || snap?.happensToday != null) return true;
  if (snap?.happenedYesterdaySameElapsed != null || snap?.happenedSameDayLastWeek != null) return true;
  if (snap?.happenedLastWeekAlignedSlice != null) return true;
  if (snap?.happenedDayBeforeSameElapsed != null) return true;
  return false;
}

export function incidentsComparisonCaption(asOfLocal?: string | null): string {
  if (!asOfLocal) {
    return 'Today (Kuwait) through page load vs each prior day over the same elapsed clock window (combined incidents).';
  }
  return `Today through ${asOfLocal.replace('T', ' ')} KWT vs each prior day over the same elapsed window (combined incidents).`;
}

export function incidentTrendFromToday(todayHits: number, priorHits: number): number | null {
  if (!Number.isFinite(todayHits) || !Number.isFinite(priorHits)) return null;
  if (priorHits <= 0) {
    if (todayHits > 0) return 100;
    if (todayHits === 0) return 0;
    return null;
  }
  return ((todayHits - priorHits) / priorHits) * 100;
}

export type TodayVsDayIncidentComparison = {
  offsetDays: number;
  date: string;
  weekday?: string;
  priorHits: number;
  trendPct: number | null;
  compareLabel: string;
  title: string;
};

function dayOffset(fromIso: string, toIso: string): number | null {
  const a = fromIso.split('-').map(Number);
  const b = toIso.split('-').map(Number);
  if (a.length !== 3 || b.length !== 3) return null;
  const t0 = Date.UTC(a[0], a[1] - 1, a[2]);
  const t1 = Date.UTC(b[0], b[1] - 1, b[2]);
  const diff = Math.round((t0 - t1) / 86400000);
  return Number.isFinite(diff) ? diff : null;
}

function sameWeekdayComparisons(
  days: IncidentsElapsedDay[],
  todayHits: number,
  todayDate?: string,
): TodayVsDayIncidentComparison[] {
  if (!todayDate || days.length < 2) return [];
  const out: TodayVsDayIncidentComparison[] = [];
  for (let i = 1; i < days.length; i++) {
    const d = days[i];
    const off = dayOffset(todayDate, d.date);
    if (off == null || off <= 0 || off % 7 !== 0) continue;
    const weeks = off / 7;
    out.push({
      offsetDays: off,
      date: d.date,
      weekday: d.weekday,
      priorHits: d.hits,
      trendPct: incidentTrendFromToday(todayHits, d.hits),
      compareLabel: weeks === 1 ? 'Same weekday last week' : `${weeks} weeks ago`,
      title: `Today vs ${formatSalesDayLabel(d.date, d.weekday)}`,
    });
  }
  return out;
}

function weekModeComparisons(
  snap: IncidentSnapTrend | undefined,
  todayHits: number,
): TodayVsDayIncidentComparison[] {
  const out: TodayVsDayIncidentComparison[] = [];
  const wtd = snap?.happensWeek;
  const aligned = snap?.happenedLastWeekAlignedSlice;
  const fullLw = snap?.happenedLastWeek;
  const heroToday = wtd != null ? Number(wtd) : todayHits;

  if (aligned != null && Number.isFinite(Number(aligned))) {
    const prior = Number(aligned);
    out.push({
      offsetDays: 0,
      date: '',
      weekday: undefined,
      priorHits: prior,
      trendPct:
        snap?.happenedPctVsPriorWeek != null
          ? Number(snap.happenedPctVsPriorWeek)
          : incidentTrendFromToday(heroToday, prior),
      compareLabel: 'Prorated prior week (WTD slice)',
      title: 'WTD vs prorated prior-week baseline',
    });
  }
  if (fullLw != null && Number.isFinite(Number(fullLw))) {
    const prior = Number(fullLw);
    out.push({
      offsetDays: 0,
      date: '',
      weekday: undefined,
      priorHits: prior,
      trendPct: incidentTrendFromToday(heroToday, prior),
      compareLabel: 'Full prior Kuwait week (reference)',
      title: 'WTD vs full prior Sun–Sat week',
    });
  }
  return out;
}

export function incidentComparisonDetail(
  heroValue: number,
  priorHits: number,
  trendPct: number | null,
  compareLabel: string,
  mode: RedAlertCompareMode,
): string {
  const hero = formatIncidentHits(heroValue);
  const prior = formatIncidentHits(priorHits);
  const pct =
    trendPct != null && Number.isFinite(trendPct)
      ? ` Change ${formatIncidentTrendPct(trendPct)} vs baseline.`
      : '';
  if (mode === 'week') {
    return `${hero} WTD incidents vs ${prior} (${compareLabel}).${pct} Higher incidents = worse.`;
  }
  if (mode === 'yesterdayVsDayBefore') {
    return `Yesterday ${hero} incidents vs ${prior} on ${compareLabel}.${pct} Higher incidents = worse.`;
  }
  return `Today ${hero} incidents vs ${prior} on ${compareLabel} (same Kuwait elapsed window).${pct}`;
}

export function trendHistoryComparisons(
  row: IncidentsElapsedRow | undefined,
  meta: DailyIncidentsElapsedResponse | undefined,
  mode: RedAlertCompareMode,
  snap?: IncidentSnapTrend,
): {
  heroLabel: string;
  heroValue: number;
  heroDate?: string;
  heroSub?: string;
  comparisons: TodayVsDayIncidentComparison[];
} {
  const days =
    row?.dailyElapsed && row.dailyElapsed.length > 0
      ? row.dailyElapsed
      : [
          ...(meta?.today
            ? [
                {
                  date: meta.today,
                  weekday: 'Today',
                  hits: row?.todayHits ?? snap?.happensToday ?? 0,
                },
              ]
            : []),
          ...(meta?.yesterday
            ? [
                {
                  date: meta.yesterday,
                  weekday: 'Yest',
                  hits: row?.yesterdaySameElapsedHits ?? 0,
                },
              ]
            : []),
        ];

  if (mode === 'week') {
    const wtd =
      snap?.happensWeek != null
        ? Number(snap.happensWeek)
        : row?.todayHits ?? days[0]?.hits ?? snap?.happensToday ?? 0;
    return {
      heroLabel: 'Week to date',
      heroValue: wtd,
      heroSub: 'Combined incidents · Kuwait week (Sun–Sat)',
      comparisons: weekModeComparisons(snap, wtd),
    };
  }

  const todayHits = days[0]?.hits ?? row?.todayHits ?? snap?.happensToday ?? 0;
  const todayDate = days[0]?.date ?? meta?.today;

  if (mode === 'sameWeekdayLw') {
    const comparisons = sameWeekdayComparisons(days, todayHits, todayDate);
    if (!comparisons.length && snap?.happenedSameDayLastWeek != null) {
      comparisons.push({
        offsetDays: 7,
        date: meta?.yesterday ?? '',
        weekday: undefined,
        priorHits: Number(snap.happenedSameDayLastWeek),
        trendPct:
          snap.happenedPctVsSameDayLastWeek != null
            ? Number(snap.happenedPctVsSameDayLastWeek)
            : incidentTrendFromToday(todayHits, Number(snap.happenedSameDayLastWeek)),
        compareLabel: 'Same weekday last week',
        title: 'Today vs same weekday last week',
      });
    }
    return {
      heroLabel: 'Today',
      heroValue: todayHits,
      heroDate: todayDate,
      comparisons,
    };
  }

  if (mode === 'yesterdayVsDayBefore') {
    const fromInc = incidentsYesterdayVsDayBefore(row);
    let yHits = fromInc.yesterdayHits;
    let dbHits = fromInc.dayBeforeHits;
    let trendPct = fromInc.trendPct;
    if (yHits == null && snap?.happenedYesterdaySameElapsed != null) {
      yHits = Number(snap.happenedYesterdaySameElapsed);
    }
    if (dbHits == null && snap?.happenedDayBeforeSameElapsed != null) {
      dbHits = Number(snap.happenedDayBeforeSameElapsed);
    }
    trendPct = resolveIncidentTrendPct(trendPct ?? snap?.happenedPctVsDayBefore, yHits, dbHits);
    const yHitsVal = yHits ?? 0;
    const yDate = days[1]?.date ?? meta?.yesterday;
    const comparisons: TodayVsDayIncidentComparison[] = [];
    if (dbHits != null && Number.isFinite(dbHits)) {
      comparisons.push({
        offsetDays: 2,
        date: days[2]?.date ?? '',
        weekday: days[2]?.weekday,
        priorHits: dbHits,
        trendPct,
        compareLabel: 'Day before yesterday',
        title: `Yesterday vs ${formatSalesDayLabel(days[2]?.date ?? '', days[2]?.weekday)}`,
      });
    }
    return {
      heroLabel: 'Yesterday',
      heroValue: yHitsVal,
      heroDate: yDate,
      heroSub: 'Same elapsed Kuwait clock (combined incidents)',
      comparisons,
    };
  }

  const comparisons: TodayVsDayIncidentComparison[] = [];
  for (let i = 1; i < days.length; i++) {
    const d = days[i];
    const offsetDays = i;
    comparisons.push({
      offsetDays,
      date: d.date,
      weekday: d.weekday,
      priorHits: d.hits,
      trendPct: incidentTrendFromToday(todayHits, d.hits),
      compareLabel: offsetDays === 1 ? 'Yesterday' : `${offsetDays} days ago`,
      title: `Today vs ${formatSalesDayLabel(d.date, d.weekday)}`,
    });
  }

  if (!comparisons.length && snap?.happenedYesterdaySameElapsed != null) {
    comparisons.push({
      offsetDays: 1,
      date: meta?.yesterday ?? '',
      weekday: undefined,
      priorHits: Number(snap.happenedYesterdaySameElapsed),
      trendPct:
        snap.happenedPctVsYesterdaySameElapsed != null
          ? Number(snap.happenedPctVsYesterdaySameElapsed)
          : incidentTrendFromToday(todayHits, Number(snap.happenedYesterdaySameElapsed)),
      compareLabel: 'Yesterday',
      title: 'Today vs yesterday',
    });
  }

  return {
    heroLabel: 'Today',
    heroValue: todayHits,
    heroDate: todayDate,
    comparisons,
  };
}
