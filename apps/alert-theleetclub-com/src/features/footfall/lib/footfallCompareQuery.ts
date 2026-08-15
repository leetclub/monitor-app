import type { CompareSelection } from '@/components/ComparePresetPicker';
import type { ReportQuery } from '@/features/footfall/lib/types';
import { presetLabels } from '@/lib/presetComparison';
import {
  addDaysYmd,
  isKuwaitBusinessDay,
  kuwaitYmd,
  lastKuwaitBusinessYmd,
} from '@/features/footfall/lib/kuwaitBusinessDay';
import {
  WINDOW_KU_JUL,
  WINDOW_MOH_O2_MAY,
  type ReportWindow,
} from '@/features/footfall/lib/segments';

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
 * On Kuwait Fri–Sat, "Today" presets often have no campus sales.
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

/** Fixed Target/Alert reference windows — always served from warm cache / DB. */
export function fixedReportWindows(): ReportWindow[] {
  return [WINDOW_KU_JUL, WINDOW_MOH_O2_MAY];
}

export function windowToReportQuery(w: ReportWindow): ReportQuery {
  return {
    startDate: w.startDate,
    endDate: w.endDate,
    enableCompare: false,
  };
}

/**
 * Live Vendon sales window from Alert compare presets (Today / WTD / custom).
 * Does not drive the heavy commercial-footfall report.
 */
export function compareSelectionToLiveSalesRange(compare: CompareSelection): {
  startDate: string;
  endDate: string;
} {
  let range = halfOpenToInclusive(compare.a.start, compare.a.end);
  if (
    compare.preset === 'today_vs_yesterday' ||
    compare.preset === 'today_vs_same_day_last_week' ||
    compare.preset === 'yesterday_vs_day_before'
  ) {
    range = snapWeekendSingleDay(range.startDate, range.endDate);
  }
  return range;
}

export function liveSalesPeriodLabel(compare: CompareSelection): string {
  const labels = presetLabels(compare.preset);
  const q = compareSelectionToLiveSalesRange(compare);
  if (q.startDate === q.endDate) {
    return `${labels.primary} · ${q.startDate}`;
  }
  return `${labels.primary} · ${q.startDate} → ${q.endDate}`;
}

/** @deprecated Use fixed windows + liveSalesPeriodLabel; kept for Analytics leftovers. */
export function compareSelectionToReportQuery(compare: CompareSelection): ReportQuery {
  const live = compareSelectionToLiveSalesRange(compare);
  return {
    startDate: live.startDate,
    endDate: live.endDate,
    enableCompare: false,
    calendarDays: true,
  };
}

export function comparePeriodShortLabel(compare: CompareSelection): string {
  return liveSalesPeriodLabel(compare);
}
