import { cameraFootfallTotal } from '@/features/footfall/lib/footfallMetrics';
import type { LocationReport, ReportPayload } from '@/features/footfall/lib/types';

type RankRow = { machineId: string; name: string; value: number };

/**
 * Recompute rankings from locations so stale API cache cannot show mirrored
 * sites as peak camera traffic. Only `actual` cameras count for the camera
 * ranking; `mirrored` and `projected` are grouped together as "mirrored" since
 * both borrow another camera's pattern.
 */
export function buildFleetRankings(locations: LocationReport[]): ReportPayload['rankings'] {
  const camera: RankRow[] = locations
    .filter((l) => l.footfallDataKind === 'actual')
    .map((l) => ({
      machineId: l.machineId,
      name: l.locationName,
      value: Math.round(cameraFootfallTotal(l)),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const projected: RankRow[] = locations
    .filter(
      (l) => l.footfallDataKind === 'projected' || l.footfallDataKind === 'mirrored',
    )
    .map((l) => ({
      machineId: l.machineId,
      name: l.locationName,
      value: Math.round(l.daily.projectedFootfall ?? l.daily.totalFootfall ?? 0),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const byRevenue = [...locations]
    .sort((a, b) => b.daily.totalRevenueKd - a.daily.totalRevenueKd)
    .map((l) => ({
      machineId: l.machineId,
      name: l.locationName,
      value: l.daily.totalRevenueKd,
    }));

  const byConversion = locations
    .filter((l) => cameraFootfallTotal(l) > 0)
    .sort((a, b) => b.daily.conversionPct - a.daily.conversionPct)
    .map((l) => ({
      machineId: l.machineId,
      name: l.locationName,
      value: l.daily.conversionPct,
    }));

  const byMissed = [...locations]
    .sort((a, b) => b.daily.illustrativeMissedPotentialKd - a.daily.illustrativeMissedPotentialKd)
    .map((l) => ({
      machineId: l.machineId,
      name: l.locationName,
      value: l.daily.illustrativeMissedPotentialKd,
    }));

  const byRpv = locations
    .filter((l) => cameraFootfallTotal(l) > 0)
    .sort((a, b) => b.daily.revenuePerVisitorKd - a.daily.revenuePerVisitorKd)
    .map((l) => ({
      machineId: l.machineId,
      name: l.locationName,
      value: l.daily.revenuePerVisitorKd,
    }));

  return {
    byFootfall: camera.slice(0, 15),
    byProjectedFootfall: projected.slice(0, 15),
    byRevenue: byRevenue.slice(0, 15),
    byConversion: byConversion.slice(0, 15),
    byMissedPotential: byMissed.slice(0, 15),
    byRevenuePerVisitor: byRpv.slice(0, 15),
  };
}
