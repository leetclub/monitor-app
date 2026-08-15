import { apiGet } from '@/lib/api';
import {
  targetCupsPerDayFromRevenue,
  TRAJECTORY_CUP_PRICE_KD,
  weekRevenueTargetKdRounded,
} from '@/features/footfall/lib/weekRevenueTarget';
import type { OwnerSegment } from '@/features/footfall/lib/types';
import { targetBusinessDaysForSegment } from '@/features/footfall/lib/weekRevenueTarget';

export type LocationTargetMetric = 'revenue' | 'cups';
export type LocationTargetPeriod = 'daily' | 'weekly' | 'monthly';

export type LocationAdminTarget = {
  machineId: string;
  dailySalesTarget: number | null;
  dailyLocationCupsTarget: number | null;
  locationTargetMetric: LocationTargetMetric;
  sxTargetPeriod: LocationTargetPeriod;
};

export type ResolvedDailyTarget = {
  cupsPerDay: number | null;
  revenueKdPerDay: number | null;
  weekRevenueKd: number | null;
  source: 'admin' | 'weekJson' | 'footfallBench' | 'none';
  detail: string[];
};

/** Convert Admin period target to a daily yardstick (same as people-api daily_yardstick). */
export function dailyYardstick(
  periodTarget: number | null | undefined,
  period: LocationTargetPeriod,
): number | null {
  if (periodTarget == null || !Number.isFinite(periodTarget) || periodTarget <= 0) return null;
  if (period === 'weekly') return periodTarget / 7;
  if (period === 'monthly') return periodTarget / 30;
  return periodTarget;
}

export async function fetchLocationTargetsMap(): Promise<Record<string, LocationAdminTarget>> {
  const data = await apiGet<{ byMachineId?: Record<string, LocationAdminTarget> }>(
    '/api/alert/targets/location-map',
  );
  return data.byMachineId ?? {};
}

/**
 * Resolve daily cups / KD targets for Footfall Targets UI.
 * Priority: Admin LMC → week revenue JSON → footfall×conversion bench fallbacks passed in.
 */
export function resolveDailyLocationTarget(opts: {
  machineId: string;
  locationName: string;
  segment: OwnerSegment;
  admin?: LocationAdminTarget | null;
  /** Footfall × segment conversion benchmark (cups/day). */
  footfallBenchCupsPerDay?: number | null;
  /** Estimated KD/day from footfall bench × unit price. */
  footfallBenchKdPerDay?: number | null;
  unitKd?: number;
}): ResolvedDailyTarget {
  const unit = opts.unitKd != null && opts.unitKd > 0 ? opts.unitKd : TRAJECTORY_CUP_PRICE_KD;
  const admin = opts.admin;
  if (admin) {
    const metric = admin.locationTargetMetric || 'revenue';
    const period = admin.sxTargetPeriod || 'daily';
    if (metric === 'cups') {
      const cupsDay = dailyYardstick(admin.dailyLocationCupsTarget, period);
      if (cupsDay != null) {
        return {
          cupsPerDay: cupsDay,
          revenueKdPerDay: cupsDay * unit,
          weekRevenueKd: cupsDay * targetBusinessDaysForSegment(opts.segment) * unit,
          source: 'admin',
          detail: [
            `Admin location cups target (${period}): ${admin.dailyLocationCupsTarget}`,
            `Daily cups yardstick: ${Math.round(cupsDay)}`,
            'Source: Admin → Targets (live_machine_config).',
          ],
        };
      }
    }
    const kdDay = dailyYardstick(admin.dailySalesTarget, period);
    if (kdDay != null) {
      return {
        cupsPerDay: kdDay / unit,
        revenueKdPerDay: kdDay,
        weekRevenueKd:
          period === 'weekly' && admin.dailySalesTarget != null
            ? admin.dailySalesTarget
            : kdDay * targetBusinessDaysForSegment(opts.segment),
        source: 'admin',
        detail: [
          `Admin location revenue target (${period}): ${admin.dailySalesTarget} KD`,
          `Daily revenue yardstick: ${kdDay.toFixed(1)} KD`,
          `Cups / day ≈ ${Math.round(kdDay / unit)} at ${unit.toFixed(2)} KD/cup`,
          'Source: Admin → Targets (live_machine_config).',
        ],
      };
    }
  }

  const weekKd = weekRevenueTargetKdRounded(opts.locationName);
  if (weekKd != null) {
    const days = targetBusinessDaysForSegment(opts.segment);
    const kdDay = weekKd / days;
    return {
      cupsPerDay: targetCupsPerDayFromRevenue(kdDay),
      revenueKdPerDay: kdDay,
      weekRevenueKd: weekKd,
      source: 'weekJson',
      detail: [
        `Weekly revenue target list: ${weekKd} KD`,
        `Daily = ${weekKd} ÷ ${days} = ${kdDay.toFixed(1)} KD`,
      ],
    };
  }

  const benchCups = opts.footfallBenchCupsPerDay;
  const benchKd = opts.footfallBenchKdPerDay;
  if (benchCups != null && benchCups > 0) {
    return {
      cupsPerDay: benchCups,
      revenueKdPerDay: benchKd ?? benchCups * unit,
      weekRevenueKd: null,
      source: 'footfallBench',
      detail: ['Fallback: footfall × segment conversion benchmark (no Admin target).'],
    };
  }

  return {
    cupsPerDay: null,
    revenueKdPerDay: null,
    weekRevenueKd: null,
    source: 'none',
    detail: ['No Admin target and no week / footfall fallback.'],
  };
}
