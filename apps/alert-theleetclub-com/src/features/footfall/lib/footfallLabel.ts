import type { LocationReport } from '@/features/footfall/lib/types';
import { displayFootfallTotal } from '@/features/footfall/lib/footfallMetrics';

/**
 * User-facing footfall taxonomy (two sources only):
 * - Mirrored footfall — no camera; shaped from a peer + segment benchmark
 * - Unique footfall — camera detections, adjusted when over-counted (repeat visitors)
 */
export type FootfallSourceKind = 'none' | 'mirrored' | 'unique';

export function footfallSourceKind(loc: LocationReport): FootfallSourceKind {
  const kind = loc.footfallDataKind ?? 'none';
  if (
    kind === 'mirrored' ||
    kind === 'projected' ||
    loc.kuFootfallEstimate
  ) {
    return 'mirrored';
  }
  if (kind === 'actual' || loc.hasPeopleFootfall) {
    return 'unique';
  }
  if (displayFootfallTotal(loc) > 0) {
    return 'mirrored';
  }
  return 'none';
}

export function isMirroredFootfall(loc: LocationReport): boolean {
  return footfallSourceKind(loc) === 'mirrored';
}

export function isUniqueFootfall(loc: LocationReport): boolean {
  return footfallSourceKind(loc) === 'unique';
}

export function mirroredPeerName(loc: LocationReport): string | undefined {
  return (
    loc.mirrorSourceName ??
    loc.projectionPeerName ??
    loc.kuFootfallEstimate?.peerName
  );
}

export function footfallPeriodLabel(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'Mirrored footfall (5 days)';
  if (src === 'unique') return 'Unique footfall (5 days)';
  return 'No footfall';
}

export function footfallPerDayLabel(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'Mirrored footfall (per day)';
  if (src === 'unique') return 'Unique footfall (per day)';
  return 'Footfall (per day)';
}

export function footfallSidebarTag(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'mirror';
  if (src === 'unique') return 'unique';
  return 'no data';
}

/** Chart series / axis name for a single location. */
export function footfallSeriesLabel(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'Mirrored footfall';
  if (src === 'unique') return 'Unique footfall';
  return 'Footfall';
}

/** Short source tag in tooltips (mirror | unique | no data). */
export function footfallSourceShort(loc: LocationReport): string {
  return footfallSidebarTag(loc);
}

/** KPI / compare table row label (period totals). */
export function footfallCompareKpiLabel(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'Mirrored footfall';
  if (src === 'unique') return 'Unique footfall';
  return 'Footfall';
}
