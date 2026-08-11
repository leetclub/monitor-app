import { alignedDayRows } from '@/features/footfall/lib/daysBreakdown';
import type { LocationReport } from '@/features/footfall/lib/types';

export type TodaySalesRow = {
  cups: number;
  cupsCashless: number;
  cupsWeb: number;
  revenueKd?: number;
  revenueCashlessKd?: number;
  /** live = Vendon today-sales API; period = matched day in loaded reference week */
  source: 'live' | 'period' | 'none';
};

export type TodaySalesApiRow = {
  cups: number;
  cupsCashless: number;
  cupsWeb: number;
  revenueKd?: number;
  revenueCashlessKd?: number;
};

function salesDatesFor(loc: LocationReport): string[] {
  return (
    loc.daily.salesPeriodDates ??
    loc.footfallPeriodDates ??
    loc.periodDates ??
    []
  );
}

/** Extract cups for one calendar day from a report location payload. */
export function salesForDay(
  loc: LocationReport,
  salesYmd: string,
): TodaySalesRow {
  const dates = salesDatesFor(loc);
  const inPeriod = dates.length === 0 || dates.includes(salesYmd);
  const rows = alignedDayRows(loc.daysBreakdown);
  const row = rows.find((r) => r.date === salesYmd);
  const d = loc.daily;

  const singleDayWindow =
    dates.length === 1 ||
    rows.length === 1 ||
    (d.footfallDayCount === 1 && inPeriod);

  const total = row?.cups ?? (singleDayWindow ? d.totalCups : undefined) ?? 0;
  const web =
    singleDayWindow && d.totalCupsWeb != null ? d.totalCupsWeb : 0;
  const cashless =
    singleDayWindow && d.totalCupsCashless != null
      ? d.totalCupsCashless
      : Math.max(0, total - web);

  if (!inPeriod && !row && !singleDayWindow) {
    return { cups: 0, cupsCashless: 0, cupsWeb: 0, source: 'none' };
  }

  if (total <= 0 && cashless <= 0 && web <= 0) {
    return { cups: 0, cupsCashless: 0, cupsWeb: 0, source: 'none' };
  }

  return {
    cups: total,
    cupsCashless: cashless,
    cupsWeb: web,
    source: 'none',
  };
}

export function resolveTodaySales(
  machineId: string,
  periodLocation: LocationReport | null | undefined,
  liveByMachine: Record<string, TodaySalesApiRow> | null | undefined,
  salesYmd: string,
  liveLoaded: boolean,
): TodaySalesRow {
  const none: TodaySalesRow = {
    cups: 0,
    cupsCashless: 0,
    cupsWeb: 0,
    source: 'none',
  };

  if (liveByMachine && machineId in liveByMachine) {
    const row = liveByMachine[machineId]!;
    return {
      cups: row.cups ?? 0,
      cupsCashless: row.cupsCashless ?? row.cups ?? 0,
      cupsWeb: row.cupsWeb ?? 0,
      revenueKd: row.revenueKd,
      revenueCashlessKd: row.revenueCashlessKd,
      source: 'live',
    };
  }

  if (liveLoaded) {
    return { cups: 0, cupsCashless: 0, cupsWeb: 0, revenueKd: 0, source: 'live' };
  }

  if (periodLocation) {
    const row = salesForDay(periodLocation, salesYmd);
    if (row.cups > 0 || row.cupsCashless > 0) {
      return { ...row, source: 'period' };
    }
  }

  return none;
}
