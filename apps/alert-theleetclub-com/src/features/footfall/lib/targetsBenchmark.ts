import type { LocationReport, OwnerSegment } from '@/features/footfall/lib/types';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';

/** Targets tab conversion benchmark by segment (not fleet default). */
export const TARGETS_BENCHMARK_BY_SEGMENT: Record<OwnerSegment, number> = {
  O2: 6.2,
  MOH: 20,
  KU: 35,
  OTHER: 6.2,
};

export function targetsBenchmarkPctForSegment(segment: OwnerSegment): number {
  return TARGETS_BENCHMARK_BY_SEGMENT[segment] ?? 6.2;
}

export function targetsBenchmarkForLocation(loc: LocationReport): number {
  return targetsBenchmarkPctForSegment(inferOwnerSegment(loc));
}

/** Cashless cups ÷ footfall × 100 for the period. */
export function periodConversionPct(loc: LocationReport): number | null {
  const ff = loc.daily.projectedFootfall ?? loc.daily.totalFootfall ?? 0;
  if (ff <= 0) return null;
  const cups = loc.daily.totalCupsCashless ?? loc.daily.totalCups ?? 0;
  return Number(((cups / ff) * 100).toFixed(2));
}

/** Hourly conversion from cashless cups (Targets tab). */
export function hourConversionPct(h: {
  footfall: number;
  cups: number;
  cupsCashless?: number;
  conversionPct: number;
}): number {
  const sold = h.cupsCashless ?? h.cups;
  if (h.footfall > 0) return (sold / h.footfall) * 100;
  return h.conversionPct;
}

export function targetCupsForFootfall(
  footfall: number,
  benchmarkPct: number,
): number {
  if (footfall <= 0) return 0;
  return (footfall * benchmarkPct) / 100;
}

export function achievementPct(
  actualCups: number,
  targetCups: number,
): number | null {
  if (targetCups <= 0) return null;
  return Math.round((actualCups / targetCups) * 10000) / 100;
}
