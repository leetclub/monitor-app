import type { ReportQuery } from '@/features/footfall/lib/types';
import { formatWeekRange } from '@/features/footfall/lib/businessWeeks';

export type PeriodContextText = {
  primary: string;
  compare: string | null;
  headline: string;
};

export function describeAppliedPeriod(q: ReportQuery): PeriodContextText {
  const primary = formatWeekRange(q.startDate, q.endDate);
  const compare =
    q.enableCompare && q.compareStartDate && q.compareEndDate
      ? formatWeekRange(q.compareStartDate, q.compareEndDate)
      : null;
  const headline = compare ? `${primary} vs ${compare}` : primary;
  return { primary, compare, headline };
}
