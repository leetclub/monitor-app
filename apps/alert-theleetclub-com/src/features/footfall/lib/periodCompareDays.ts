import { alignedDayRows } from '@/features/footfall/lib/daysBreakdown';
import type { DayBreakdownRow, DaysBreakdown, LocationReport } from '@/features/footfall/lib/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type PeriodCompareDaySlot = {
  label: string;
  primaryDate: string | null;
  compareDate: string | null;
  primary: DayBreakdownRow | null;
  compare: DayBreakdownRow | null;
};

/** Align primary vs compare weeks by business-day index (Sun–Thu), not calendar date. */
export function periodCompareDaySlots(
  location: LocationReport,
  compareBreakdown?: DaysBreakdown | null,
): PeriodCompareDaySlot[] {
  const primary = alignedDayRows(location.daysBreakdown);
  const compare = alignedDayRows(compareBreakdown ?? location.compareDaysBreakdown ?? undefined);
  const n = Math.max(primary.length, compare.length, 1);
  return Array.from({ length: n }, (_, i) => ({
    label: WEEKDAY_LABELS[i] ?? `Day ${i + 1}`,
    primaryDate: primary[i]?.date ?? null,
    compareDate: compare[i]?.date ?? null,
    primary: primary[i] ?? null,
    compare: compare[i] ?? null,
  }));
}

export function hasDailyPeriodCompare(location: LocationReport): boolean {
  return Boolean(
    location.comparePeriodDates?.length &&
      (alignedDayRows(location.compareDaysBreakdown ?? undefined).length > 0 ||
        alignedDayRows(location.daysBreakdown).length > 0),
  );
}
