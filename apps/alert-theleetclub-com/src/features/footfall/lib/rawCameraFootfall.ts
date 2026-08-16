/**
 * Raw-camera view: no unique-visitor ratio, no mirror/projection fill.
 * Mirrored / projected / none sites show 0 camera footfall (sales unchanged).
 * Metadata is stripped so UI never says "Mirrored" / "Unique" in this mode.
 */
import type { DayBreakdownRow, DaysBreakdown, HourRow, LocationReport } from './types';

function zeroHour(h: HourRow): HourRow {
  const { footfallMirror: _drop, ...rest } = h;
  return {
    ...rest,
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

function stripHourMirror(h: HourRow): HourRow {
  if (!h.footfallMirror) return h;
  const { footfallMirror: _drop, ...rest } = h;
  return rest;
}

function zeroDayRow(d: DayBreakdownRow): DayBreakdownRow {
  return {
    ...d,
    footfall: 0,
    conversionPct: 0,
    conversionRatio: '—',
    revenuePerVisitorKd: 0,
    footfallEstimated: false,
  };
}

function stripDayEstimate(d: DayBreakdownRow): DayBreakdownRow {
  if (!d.footfallEstimated) return d;
  return { ...d, footfallEstimated: false };
}

function mapDays(
  days: DaysBreakdown,
  mapRow: (d: DayBreakdownRow) => DayBreakdownRow,
): DaysBreakdown {
  if (days.mode === 'aligned') {
    return { ...days, rows: days.rows.map(mapRow) };
  }
  return {
    ...days,
    salesRows: days.salesRows.map(mapRow),
    footfallRows: days.footfallRows.map(mapRow),
    rows: days.rows?.map(mapRow),
  };
}

function isNonCameraFootfall(loc: LocationReport): boolean {
  const kind = loc.footfallDataKind ?? 'none';
  if (kind === 'mirrored' || kind === 'projected' || kind === 'none') return true;
  if (loc.kuFootfallEstimate) return true;
  if (!loc.hasPeopleFootfall && kind !== 'actual') return true;
  return false;
}

export function applyRawCameraFootfall(loc: LocationReport): LocationReport {
  if (isNonCameraFootfall(loc)) {
    return {
      ...loc,
      hours: loc.hours.map(zeroHour),
      daysBreakdown: mapDays(loc.daysBreakdown as DaysBreakdown, zeroDayRow),
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
        conversionNote: undefined,
      },
      rawFootfallTotal: 0,
      rawAvgDailyFootfall: 0,
      uniqueAdjusted: false,
      uniqueFootfallBreakdown: undefined,
      kuFootfallEstimate: undefined,
      hasPeopleFootfall: false,
      footfallDataKind: 'none',
      mirrorSourceName: null,
      mirrorDisplay: null,
      projectionPeerName: null,
      footfallDisplay: null,
    };
  }

  return {
    ...loc,
    hours: loc.hours.map(stripHourMirror),
    daysBreakdown: mapDays(loc.daysBreakdown as DaysBreakdown, stripDayEstimate),
    uniqueAdjusted: false,
    uniqueFootfallBreakdown: undefined,
    kuFootfallEstimate: undefined,
    mirrorSourceName: null,
    mirrorDisplay: null,
    projectionPeerName: null,
    footfallDisplay: null,
    footfallDataKind: 'actual',
    hasPeopleFootfall: true,
    rawFootfallTotal: loc.daily.totalFootfall,
    rawAvgDailyFootfall: loc.daily.avgDailyFootfall,
  };
}
