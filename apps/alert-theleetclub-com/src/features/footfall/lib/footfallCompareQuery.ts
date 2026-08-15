import type { CompareSelection } from '@/components/ComparePresetPicker';
import type { ReportQuery } from '@/features/footfall/lib/types';
import { presetLabels } from '@/lib/presetComparison';
import {
  addDaysYmd,
  isKuwaitBusinessDay,
  kuwaitYmd,
  lastKuwaitBusinessYmd,
} from '@/features/footfall/lib/kuwaitBusinessDay';

/** Alert ranges are half-open [start, endExclusive). Commercial footfall uses inclusive end. */
export function halfOpenToInclusive(start: string, endExclusive: string): {
  startDate: string;
  endDate: string;
} {
  const endDate = addDaysYmd(endExclusive, -1);
  if (endDate < start) {
    return { startDate: start, endDate: start };
  }
  return { startDate: start, endDate };
}

/**
 * On Kuwait Fri–Sat, "Today" presets often have no campus data.
 * Snap a single calendar day that is Kuwait today on a weekend → last business day.
 */
function snapWeekendSingleDay(startDate: string, endDate: string): {
  startDate: string;
  endDate: string;
} {
  if (startDate !== endDate) return { startDate, endDate };
  const dt = new Date(`${startDate}T12:00:00`);
  if (isKuwaitBusinessDay(dt)) return { startDate, endDate };
  if (startDate === kuwaitYmd()) {
    const biz = lastKuwaitBusinessYmd();
    return { startDate: biz, endDate: biz };
  }
  return { startDate, endDate };
}

function inclusivePeriodFromCompare(compare: CompareSelection): {
  startDate: string;
  endDate: string;
} {
  let primary = halfOpenToInclusive(compare.a.start, compare.a.end);
  if (
    compare.preset === 'today_vs_yesterday' ||
    compare.preset === 'today_vs_same_day_last_week' ||
    compare.preset === 'yesterday_vs_day_before'
  ) {
    primary = snapWeekendSingleDay(primary.startDate, primary.endDate);
  }
  return primary;
}

/**
 * Heavy commercial-footfall report follows the user's Period dates (Alert presets /
 * custom). Primary only + calendar_days (skips May fallback on the server).
 */
export function compareSelectionToReportQuery(compare: CompareSelection): ReportQuery {
  const primary = inclusivePeriodFromCompare(compare);
  return {
    startDate: primary.startDate,
    endDate: primary.endDate,
    enableCompare: false,
    calendarDays: true,
  };
}

/** Same inclusive Period window for live Vendon Achievement / Daily Target. */
export function compareSelectionToLiveSalesRange(compare: CompareSelection): {
  startDate: string;
  endDate: string;
} {
  return inclusivePeriodFromCompare(compare);
}

export function comparePeriodShortLabel(compare: CompareSelection): string {
  const labels = presetLabels(compare.preset);
  const q = inclusivePeriodFromCompare(compare);
  if (q.startDate === q.endDate) {
    return `${labels.primary} · ${q.startDate}`;
  }
  return `${labels.primary} · ${q.startDate} → ${q.endDate}`;
}

export const liveSalesPeriodLabel = comparePeriodShortLabel;
