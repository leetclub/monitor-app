import type { CompareSelection } from '@/components/ComparePresetPicker';
import type { ReportQuery } from '@/features/footfall/lib/types';
import { presetLabels } from '@/lib/presetComparison';

/** Alert ranges are half-open [start, endExclusive). Commercial footfall uses inclusive end. */
function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

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

/** Build commercial-footfall report query from Alert compare selection. */
export function compareSelectionToReportQuery(compare: CompareSelection): ReportQuery {
  const primary = halfOpenToInclusive(compare.a.start, compare.a.end);
  const baseline = halfOpenToInclusive(compare.b.start, compare.b.end);
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
  const primary = halfOpenToInclusive(compare.a.start, compare.a.end);
  if (primary.startDate === primary.endDate) {
    return `${labels.primary} · ${primary.startDate}`;
  }
  return `${labels.primary} · ${primary.startDate} → ${primary.endDate}`;
}
