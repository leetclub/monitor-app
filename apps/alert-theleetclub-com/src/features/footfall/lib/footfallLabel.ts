import type { LocationReport } from '@/features/footfall/lib/types';

/**
 * User-facing footfall taxonomy:
 * - Mirrored — no camera; peer / projection (Mirror & adjust only)
 * - Unique — camera + unique-visitor ratio (Mirror & adjust only)
 * - Measured — camera detections as measured (As measured mode)
 *
 * Do not call displayFootfallTotal / isMirroredFootfall from here — those call
 * footfallSourceKind and would recurse forever.
 */
export type FootfallSourceKind = 'none' | 'mirrored' | 'unique' | 'measured';

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
    return loc.uniqueAdjusted ? 'unique' : 'measured';
  }
  if ((loc.daily.projectedFootfall ?? 0) > 0) {
    return 'mirrored';
  }
  if ((loc.daily.totalFootfall ?? 0) > 0) {
    return loc.uniqueAdjusted ? 'unique' : 'measured';
  }
  return 'none';
}

export function isMirroredFootfall(loc: LocationReport): boolean {
  return footfallSourceKind(loc) === 'mirrored';
}

export function isUniqueFootfall(loc: LocationReport): boolean {
  return footfallSourceKind(loc) === 'unique';
}

export function isMeasuredFootfall(loc: LocationReport): boolean {
  return footfallSourceKind(loc) === 'measured';
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
  if (src === 'measured') return 'As measured (5 days)';
  return 'No footfall';
}

export function footfallPerDayLabel(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'Mirrored footfall (per day)';
  if (src === 'unique') return 'Unique footfall (per day)';
  if (src === 'measured') return 'As measured (per day)';
  return 'Footfall (per day)';
}

export function footfallSidebarTag(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'mirror';
  if (src === 'unique') return 'unique';
  if (src === 'measured') return 'as measured';
  return 'no data';
}

/** Chart series / axis name for a single location. */
export function footfallSeriesLabel(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'Mirrored footfall';
  if (src === 'unique') return 'Unique footfall';
  if (src === 'measured') return 'As measured';
  return 'Footfall';
}

/** Short source tag in tooltips (mirror | unique | as measured | no data). */
export function footfallSourceShort(loc: LocationReport): string {
  return footfallSidebarTag(loc);
}

/** KPI / compare table row label (period totals). */
export function footfallCompareKpiLabel(loc: LocationReport): string {
  const src = footfallSourceKind(loc);
  if (src === 'mirrored') return 'Mirrored footfall';
  if (src === 'unique') return 'Unique footfall';
  if (src === 'measured') return 'As measured';
  return 'Footfall';
}
