import type { LocationReport } from '@/features/footfall/lib/types';

/** True when footfall is mirrored (no camera on this machine). */
export function isEstimatedFootfall(loc: LocationReport): boolean {
  const kind = loc.footfallDataKind ?? 'none';
  return (
    kind === 'mirrored' ||
    kind === 'projected' ||
    Boolean(loc.kuFootfallEstimate)
  );
}

/** Camera or mirrored detections only — for fleet peak-traffic ranking. */
export function cameraFootfallTotal(loc: LocationReport): number {
  if (isEstimatedFootfall(loc)) return 0;
  return loc.daily.totalFootfall;
}

/** KPI / charts: projected estimate when there is no camera. */
export function displayFootfallTotal(loc: LocationReport): number {
  if (isEstimatedFootfall(loc)) {
    return loc.daily.projectedFootfall ?? 0;
  }
  return loc.daily.totalFootfall;
}

export function isProjectedFootfall(loc: LocationReport): boolean {
  return isEstimatedFootfall(loc);
}
