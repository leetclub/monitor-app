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
 * On Kuwait Fri–Sat, "Today" presets often have no campus footfall.
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

/** Build commercial-footfall report query from Alert compare selection. */
export function compareSelectionToReportQuery(compare: CompareSelection): ReportQuery {
  let primary = halfOpenToInclusive(compare.a.start, compare.a.end);
  let baseline = halfOpenToInclusive(compare.b.start, compare.b.end);
  if (
    compare.preset === 'today_vs_yesterday' ||
    compare.preset === 'today_vs_same_day_last_week'
  ) {
    primary = snapWeekendSingleDay(primary.startDate, primary.endDate);
  }
  if (compare.preset === 'today_vs_yesterday') {
    baseline = snapWeekendSingleDay(baseline.startDate, baseline.endDate);
  }
  return {
    startDate: primary.startDate,
    endDate: primary.endDate,
    enableCompare: true,
    compareStartDate: baseline.startDate,
    compareEndDate: baseline.endDate,
    calendarDays: true,
  };
}

export function comparePeriodShortLabel(compare: CompareSelection): string {
  const labels = presetLabels(compare.preset);
  const q = compareSelectionToReportQuery(compare);
  if (q.startDate === q.endDate) {
    return `${labels.primary} · ${q.startDate}`;
  }
  return `${labels.primary} · ${q.startDate} → ${q.endDate}`;
}
