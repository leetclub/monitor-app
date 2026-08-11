/**
 * Raw-camera view: no unique-visitor ratio, no mirror/projection fill.
 * Mirrored / projected / none sites show 0 camera footfall (sales unchanged).
 */
import type { DayBreakdownRow, DaysBreakdown, HourRow, LocationReport } from './types';
import { isMirroredFootfall } from './footfallLabel';

function zeroHour(h: HourRow): HourRow {
  return {
    ...h,
    peopleIn: 0,
    peopleOut: 0,
    netTraffic: 0,
    footfall: 0,
    aspiredCups: 0,
    upliftCups: 0,
    upliftKd: 0,
    conversionPct: 0,
    conversionRatio: '—',
    revenuePerVisitorKd: 0,
  };
}

function zeroDayRow(d: DayBreakdownRow): DayBreakdownRow {
  return {
    ...d,
    footfall: 0,
    conversionPct: 0,
    conversionRatio: '—',
    revenuePerVisitorKd: 0,
  };
}

function zeroDays(days: DaysBreakdown): DaysBreakdown {
  if (days.mode === 'aligned') {
    return { ...days, rows: days.rows.map(zeroDayRow) };
  }
  return {
    ...days,
    salesRows: days.salesRows.map(zeroDayRow),
    footfallRows: days.footfallRows.map(zeroDayRow),
    rows: days.rows?.map(zeroDayRow),
  };
}

export function applyRawCameraFootfall(loc: LocationReport): LocationReport {
  if (isMirroredFootfall(loc) || loc.footfallDataKind === 'projected' || loc.footfallDataKind === 'none') {
    return {
      ...loc,
      hours: loc.hours.map(zeroHour),
      daysBreakdown: zeroDays(loc.daysBreakdown as DaysBreakdown),
      daily: {
        ...loc.daily,
        totalFootfall: 0,
        avgDailyFootfall: 0,
        projectedFootfall: 0,
        totalIn: 0,
        totalOut: 0,
        totalNet: 0,
        avgDailyNet: 0,
        conversionPct: 0,
        conversionRatio: '—',
        revenuePerVisitorKd: 0,
        illustrativeMissedPotentialKd: 0,
        detectionsPerCup: null,
        salesTargetCups: 0,
        salesTargetRevenueKd: 0,
        salesUpliftCups: 0,
        salesUpliftKd: 0,
        hourlyProfileFootfallSum: 0,
      },
      rawFootfallTotal: 0,
      rawAvgDailyFootfall: 0,
      uniqueAdjusted: false,
      uniqueFootfallBreakdown: undefined,
      kuFootfallEstimate: undefined,
      hasPeopleFootfall: false,
    };
  }

  return {
    ...loc,
    uniqueAdjusted: false,
    uniqueFootfallBreakdown: undefined,
    kuFootfallEstimate: undefined,
    rawFootfallTotal: loc.daily.totalFootfall,
    rawAvgDailyFootfall: loc.daily.avgDailyFootfall,
  };
}
