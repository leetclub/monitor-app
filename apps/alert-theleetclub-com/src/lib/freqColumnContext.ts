import type { RedAlertCompareMode, RedAlertRow } from '@/features/redflags/redAlertTypes';
import { freqSplit, type FreqSplit } from '@/features/redflags/redFlagsModel';
import { incidentsDayHits, type IncidentsElapsedRow } from '@/lib/incidentsDisplay';

export type FreqColumnContext = {
  fq: FreqSplit;
  scoreText: string;
  trendText: string;
  gapDisplay: string;
  scoreExplain: string;
  trendExplain: string;
  gapExplain: string;
  freqColumnTooltip: string;
};

/** Shared Score / Trend / Gap labels for table tooltips and history modals. */
export function buildFreqColumnContext(
  row: RedAlertRow,
  compareMode: RedAlertCompareMode,
  incidents?: IncidentsElapsedRow,
): FreqColumnContext {
  const fq = freqSplit(row, compareMode, incidents);
  const todayHitsRaw = row.happensToday != null ? row.happensToday : row.frequency?.totalCriteriaHitsToday;
  const todayHits = todayHitsRaw != null ? Number(todayHitsRaw) : NaN;
  const yesterdayHits =
    compareMode === 'yesterdayVsDayBefore'
      ? (() => {
          const fromInc = incidentsDayHits(incidents, 1);
          if (fromInc != null) return fromInc;
          const snapY =
            row.happenedYesterdaySameElapsed ?? row.frequency?.totalCriteriaHitsYesterdaySameElapsed;
          return snapY != null && Number.isFinite(Number(snapY)) ? Number(snapY) : null;
        })()
      : incidentsDayHits(incidents, 1);
  const scoreText =
    compareMode === 'week'
      ? fq.top
      : compareMode === 'yesterdayVsDayBefore'
        ? yesterdayHits != null
          ? `${yesterdayHits}/d`
          : fq.top
        : !Number.isNaN(todayHits)
          ? `${todayHits}/d`
          : fq.top;
  const trendText = fq.bottom;

  const gapRaw =
    compareMode === 'week'
      ? row.happensWeek != null
        ? row.happensWeek
        : row.frequency?.totalCriteriaHitsThisWeek
      : compareMode === 'yesterdayVsDayBefore'
        ? yesterdayHits
        : todayHitsRaw;
  const gapN =
    gapRaw == null
      ? NaN
      : (() => {
          const nn = Number(gapRaw);
          return Number.isNaN(nn) ? NaN : Math.max(0, nn);
        })();
  const gapDisplay = Number.isNaN(gapN) ? '—' : gapN <= 0 ? '↓0' : `↓${gapN}`;

  const scoreExplain =
    compareMode === 'week'
      ? 'Combined incidents (stale sale + OFF + vend fail) week-to-date in Kuwait (Sun–Sat). 0 = green.'
      : compareMode === 'yesterdayVsDayBefore'
        ? 'Combined incidents yesterday (full Kuwait calendar day). 0 = green.'
        : 'Combined incidents today so far (Kuwait calendar day). 0 = green.';

  const trendExplain = fq.title;

  const gapExplain = Number.isNaN(gapN)
    ? 'Gap to green unknown (missing incident count).'
    : gapN <= 0
      ? 'At green: zero combined incidents — no further reduction needed (↓0).'
      : `Not green yet: incidents must come down by ${gapN} (↓${gapN}) to reach green (0).`;

  const freqColumnTooltip = [
    fq.title,
    '',
    `Score ${scoreText}: combined incident load for this timespan (0 = good).`,
    `Trend ${trendText}: vs baseline (↓ better, ↑ worse for incidents).`,
    gapExplain,
    '',
    compareMode === 'yesterdayVsDayBefore'
      ? 'Tap Trend for yesterday vs day before (full calendar days).'
      : 'Tap Trend for today vs prior days (same elapsed window).',
  ].join('\n');

  return {
    fq,
    scoreText,
    trendText,
    gapDisplay,
    scoreExplain,
    trendExplain,
    gapExplain,
    freqColumnTooltip,
  };
}

export function trendModalLegend(compareMode: RedAlertCompareMode): string {
  if (compareMode === 'week') {
    return 'Weekly % uses WTD vs prorated last week (full last week × fraction of this week elapsed), not vs the full seven-day prior week total.';
  }
  if (compareMode === 'sameWeekdayLw') {
    return 'Compares Kuwait today-so-far vs the same elapsed window on the same weekday last week.';
  }
  if (compareMode === 'yesterdayVsDayBefore') {
    return 'Compares full Kuwait calendar-day incident totals: yesterday vs the day before yesterday.';
  }
  return 'Compares Kuwait today-so-far vs the same elapsed window on each prior calendar day.';
}
