import type { LocationReport } from '@/features/footfall/lib/types';

import { isMirroredFootfall } from '@/features/footfall/lib/footfallLabel';

/** True when footfall is mirrored (no camera on this machine). */
export function isEstimatedFootfall(loc: LocationReport): boolean {
  return isMirroredFootfall(loc);
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
