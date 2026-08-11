/**
 * Unique footfall estimation + LocationReport transform.
 *
 * Algorithm:
 *   raw         = peopleIn over the 5-day window
 *   factor_est  = raw * SEGMENT_CALIBRATION[segment]
 *   floor       = Σ over hours of max(0, in - out)
 *   ceiling     = raw
 *   unique      = clamp(factor_est, floor, ceiling)
 *
 * `applyUniqueFootfallToLocation()` returns a new LocationReport whose
 * footfall numbers and footfall-derived KPIs (conversion, KD per visit,
 * missed potential, hourly aspired/uplift, daily breakdown footfall,
 * peopleIn / peopleOut / netTraffic) all use the unique estimate. Sales
 * numbers (cups, revenue) are never adjusted.
 */
import type {
  DayBreakdownRow,
  DailyTotals,
  DaysBreakdown,
  HourRow,
  LocationReport,
  OwnerSegment,
} from './types';

/** Per-segment calibration: multiply raw detections by this. */
export const SEGMENT_CALIBRATION: Record<OwnerSegment, number> = {
  O2: 0.4,
  MOH: 1.0,
  KU: 1.0,
  OTHER: 1.0,
};

/** Short note shown next to each calibration factor in the UI. */
export const CALIBRATION_RATIONALE: Record<OwnerSegment, string> = {
  O2: 'Detections divided by 2.5 (factor 0.40).',
  MOH: 'Capped when detections exceed segment benchmark (repeat visitors).',
  KU: 'No adjustment.',
  OTHER: 'No adjustment.',
};

export type UniqueFootfallBreakdown = {
  rawDetections: number;
  factor: number;
  factorEstimate: number;
  netArrivalsFloor: number;
  uniqueEstimate: number;
  uniqueAvgPerDay: number;
  dayCount: number;
  segment: OwnerSegment;
  floorActive: boolean;
  ceilingActive: boolean;
  netSignalMissing: boolean;
  summary: string;
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function hourlyNetArrivals(hours: HourRow[]): { floor: number; missing: boolean } {
  if (!hours || hours.length === 0) return { floor: 0, missing: true };
  let saw = false;
  let total = 0;
  for (const h of hours) {
    if (typeof h.peopleIn === 'number' || typeof h.peopleOut === 'number') {
      saw = true;
      total += Math.max(0, (h.peopleIn ?? 0) - (h.peopleOut ?? 0));
    }
  }
  return { floor: total, missing: !saw };
}

export function computeUniqueFootfall(
  loc: LocationReport,
  segment: OwnerSegment,
  benchmarkPct = 20,
): UniqueFootfallBreakdown {
  const dayCount = loc.daily.footfallDayCount ?? loc.periodDates?.length ?? 5;
  const raw =
    (loc.daily.totalIn ?? 0) > 0
      ? (loc.daily.totalIn as number)
      : loc.daily.totalFootfall || loc.daily.projectedFootfall || 0;

  let factor = SEGMENT_CALIBRATION[segment] ?? 1.0;
  const cups = loc.daily.totalCupsCashless ?? loc.daily.totalCups ?? 0;
  if (benchmarkPct > 0 && raw > 0 && cups > 0) {
    const targetUnique = cups / (benchmarkPct / 100);
    if (raw > targetUnique * 1.08) {
      factor = Math.min(factor, targetUnique / raw);
    }
  }

  const factorEstimate = raw * factor;

  const { floor: rawFloor, missing: netSignalMissing } = hourlyNetArrivals(loc.hours);
  const netArrivalsFloor = netSignalMissing ? factorEstimate : rawFloor;

  const ceiling = raw;
  let unique = factorEstimate;
  let floorActive = false;
  let ceilingActive = false;
  if (unique < netArrivalsFloor) {
    unique = netArrivalsFloor;
    floorActive = true;
  }
  if (unique > ceiling) {
    unique = ceiling;
    ceilingActive = true;
  }

  const uniqueAvgPerDay = dayCount > 0 ? unique / dayCount : unique;

  const overCountNote =
    factor < (SEGMENT_CALIBRATION[segment] ?? 1) - 0.001
      ? ' · benchmark cap (repeat visitors)'
      : '';
  const summary =
    `Raw ${fmt(raw)} × ${factor.toFixed(2)} = ${fmt(factorEstimate)}${overCountNote}` +
    (netSignalMissing
      ? ' (no in/out signal — factor only)'
      : ` · net-arrivals floor ${fmt(netArrivalsFloor)}`) +
    ` → unique ${fmt(unique)}`;

  return {
    rawDetections: raw,
    factor,
    factorEstimate,
    netArrivalsFloor,
    uniqueEstimate: unique,
    uniqueAvgPerDay,
    dayCount,
    segment,
    floorActive,
    ceilingActive,
    netSignalMissing,
    summary,
  };
}

/** Recompute conversion string in the format "1 : N". */
function fmtConversionRatio(footfall: number, cups: number): string {
  if (!(footfall > 0) || !(cups > 0)) return '—';
  return `1 : ${(footfall / cups).toFixed(1)}`;
}

function scaleHourRow(h: HourRow, ratio: number, benchmarkPct: number, pricePerCup: number): HourRow {
  const newFoot = h.footfall * ratio;
  const newAspired = newFoot * (benchmarkPct / 100);
  const newUpliftCups = Math.max(0, newAspired - h.cups);
  return {
    ...h,
    footfall: newFoot,
    conversionPct:
      newFoot > 0 ? Number(((h.cups / newFoot) * 100).toFixed(2)) : 0,
    conversionRatio: fmtConversionRatio(newFoot, h.cups),
    revenuePerVisitorKd:
      newFoot > 0 ? Number((h.revenueKd / newFoot).toFixed(4)) : 0,
    aspiredCups: newAspired,
    upliftCups: newUpliftCups,
    upliftKd: newUpliftCups * pricePerCup,
    peopleIn: h.peopleIn != null ? Math.round(h.peopleIn * ratio) : undefined,
    peopleOut: h.peopleOut != null ? Math.round(h.peopleOut * ratio) : undefined,
    netTraffic: h.netTraffic != null ? Math.round(h.netTraffic * ratio) : undefined,
    footfallMirror: h.footfallMirror
      ? { ...h.footfallMirror, value: Math.round(h.footfallMirror.value * ratio) }
      : undefined,
  };
}

function scaleDayRow(r: DayBreakdownRow, ratio: number): DayBreakdownRow {
  const newFoot = r.footfall * ratio;
  return {
    ...r,
    footfall: newFoot,
    conversionPct: newFoot > 0 ? Number(((r.cups / newFoot) * 100).toFixed(2)) : 0,
    conversionRatio: fmtConversionRatio(newFoot, r.cups),
    revenuePerVisitorKd:
      newFoot > 0 ? Number((r.revenueKd / newFoot).toFixed(4)) : 0,
  };
}

function scaleDaysBreakdown(
  db: DaysBreakdown | DayBreakdownRow[],
  ratio: number,
): DaysBreakdown | DayBreakdownRow[] {
  if (Array.isArray(db)) return db.map((r) => scaleDayRow(r, ratio));
  if (db.mode === 'aligned') {
    return { ...db, rows: db.rows.map((r) => scaleDayRow(r, ratio)) };
  }
  return {
    ...db,
    footfallRows: db.footfallRows.map((r) => scaleDayRow(r, ratio)),
    salesRows: db.salesRows,
    rows: db.rows ? db.rows.map((r) => scaleDayRow(r, ratio)) : undefined,
  };
}

/**
 * Return a new LocationReport whose footfall numbers are unique-adjusted.
 * Sales (cups, revenue) are NEVER changed. All footfall-derived metrics
 * (conversion, revenue/visitor, aspired cups, uplift, missed KD) are
 * re-derived from the new footfall.
 */
export function applyUniqueFootfallToLocation(
  loc: LocationReport,
  segment: OwnerSegment,
  benchmarkPct: number,
): LocationReport {
  const kind = loc.footfallDataKind;
  // Mirrored/projected footfall is already produced server-side (same-segment peer).
  // Do not run the O2/MOH unique calibration on top — Analytics and Targets both
  // show API values as-is for these kinds.
  if (kind === 'mirrored' || kind === 'projected' || kind === 'none') {
    return {
      ...loc,
      rawFootfallTotal: loc.daily.totalFootfall,
      rawAvgDailyFootfall: loc.daily.avgDailyFootfall,
      uniqueAdjusted: false,
    };
  }

  const breakdown = computeUniqueFootfall(loc, segment, benchmarkPct);
  const rawTotal = loc.daily.totalFootfall;
  const rawAvg = loc.daily.avgDailyFootfall;
  const ratio =
    breakdown.rawDetections > 0
      ? breakdown.uniqueEstimate / breakdown.rawDetections
      : breakdown.factor;

  const cupsWeek = loc.daily.totalCups || 0;
  const revenueWeek = loc.daily.totalRevenueKd || 0;
  const uniqueWeek = breakdown.uniqueEstimate;
  const dayCount = breakdown.dayCount || 5;
  const pricePerCup = cupsWeek > 0 ? revenueWeek / cupsWeek : 0;

  const aspiredCupsWeek = uniqueWeek * (benchmarkPct / 100);
  const missedCupsWeek = Math.max(0, aspiredCupsWeek - cupsWeek);
  const missedKdWeek = missedCupsWeek * pricePerCup;

  const newDaily: DailyTotals = {
    ...loc.daily,
    totalFootfall: Math.round(uniqueWeek),
    avgDailyFootfall: dayCount > 0 ? uniqueWeek / dayCount : uniqueWeek,
    projectedFootfall:
      loc.daily.projectedFootfall != null
        ? Math.round(loc.daily.projectedFootfall * ratio)
        : undefined,
    hourlyProfileFootfallSum:
      loc.daily.hourlyProfileFootfallSum != null
        ? loc.daily.hourlyProfileFootfallSum * ratio
        : undefined,
    conversionPct:
      uniqueWeek > 0 ? Number(((cupsWeek / uniqueWeek) * 100).toFixed(2)) : 0,
    conversionRatio: fmtConversionRatio(uniqueWeek, cupsWeek),
    revenuePerVisitorKd:
      uniqueWeek > 0 ? Number((revenueWeek / uniqueWeek).toFixed(4)) : 0,
    illustrativeMissedPotentialKd: Number(missedKdWeek.toFixed(2)),
    totalIn:
      loc.daily.totalIn != null ? Math.round(loc.daily.totalIn * ratio) : undefined,
    totalOut:
      loc.daily.totalOut != null ? Math.round(loc.daily.totalOut * ratio) : undefined,
    totalNet:
      loc.daily.totalNet != null ? Math.round(loc.daily.totalNet * ratio) : undefined,
    avgDailyNet:
      loc.daily.avgDailyNet != null ? loc.daily.avgDailyNet * ratio : undefined,
    detectionsPerCup:
      uniqueWeek > 0 && cupsWeek > 0
        ? Number((uniqueWeek / cupsWeek).toFixed(2))
        : null,
    salesTargetCups:
      loc.daily.salesTargetCups != null ? Math.round(aspiredCupsWeek) : undefined,
    salesTargetRevenueKd:
      loc.daily.salesTargetRevenueKd != null
        ? Number((aspiredCupsWeek * pricePerCup).toFixed(2))
        : undefined,
    salesUpliftCups:
      loc.daily.salesUpliftCups != null ? Math.round(missedCupsWeek) : undefined,
    salesUpliftKd:
      loc.daily.salesUpliftKd != null
        ? Number(missedKdWeek.toFixed(2))
        : undefined,
  };

  if (Math.abs(ratio - 1) < 0.001) {
    return {
      ...loc,
      rawFootfallTotal: rawTotal,
      rawAvgDailyFootfall: rawAvg,
      uniqueFootfallBreakdown: breakdown,
      uniqueAdjusted: true,
    };
  }

  const newHours = loc.hours.map((h) => scaleHourRow(h, ratio, benchmarkPct, pricePerCup));
  const newDaysBreakdown = scaleDaysBreakdown(loc.daysBreakdown, ratio);

  return {
    ...loc,
    hours: newHours,
    daily: newDaily,
    daysBreakdown: newDaysBreakdown,
    rawFootfallTotal: rawTotal,
    rawAvgDailyFootfall: rawAvg,
    uniqueFootfallBreakdown: breakdown,
    uniqueAdjusted: true,
  };
}

/** Strip period-compare so the targets app never tries to render compare UI. */
export function stripCompare(loc: LocationReport): LocationReport {
  return {
    ...loc,
    comparePeriodDates: null,
    compareHours: null,
    compareDaily: null,
    compareDaysBreakdown: null,
  };
}
