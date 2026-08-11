import type { HourRow } from '@/features/footfall/lib/types';

/** Revenue axis & summary benchmark on the hourly infographic (KD). */
export const HOURLY_REVENUE_REFERENCE_KD = 100;

export type HourlyCaptureSummary = {
  totalFootfall: number;
  totalCups: number;
  totalAspired: number;
  totalMissedCups: number;
  totalMissedKd: number;
  totalRevenueKd: number;
  revenuePctOfReference: number;
  capturePct: number;
  weakHourCount: number;
};

export function hourlyCaptureSummary(hours: HourRow[]): HourlyCaptureSummary {
  let totalFootfall = 0;
  let totalCups = 0;
  let totalAspired = 0;
  let totalMissedCups = 0;
  let totalMissedKd = 0;
  let totalRevenueKd = 0;
  let weakHourCount = 0;

  for (const h of hours) {
    totalFootfall += h.footfall;
    totalCups += h.cups;
    totalAspired += h.aspiredCups;
    totalMissedCups += h.upliftCups;
    totalMissedKd += h.upliftKd;
    totalRevenueKd += h.revenueKd;
    if (h.isWeakConversion) weakHourCount += 1;
  }

  const capturePct =
    totalAspired > 0 ? Math.round((totalCups / totalAspired) * 1000) / 10 : 0;
  const revenuePctOfReference =
    HOURLY_REVENUE_REFERENCE_KD > 0
      ? Math.round((totalRevenueKd / HOURLY_REVENUE_REFERENCE_KD) * 1000) / 10
      : 0;

  return {
    totalFootfall,
    totalCups,
    totalAspired,
    totalMissedCups,
    totalMissedKd,
    totalRevenueKd,
    revenuePctOfReference,
    capturePct,
    weakHourCount,
  };
}
