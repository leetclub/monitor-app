import type { LocationReport, OwnerSegment } from './types';

/** Match server `_owner_segment` when API/cache omits `ownerSegment`. */
export function inferOwnerSegment(loc: LocationReport): OwnerSegment {
  if (loc.ownerSegment) return loc.ownerSegment;
  const owner = (loc.locationOwner || '').trim().toUpperCase();
  const n = (loc.locationName || '').toLowerCase();
  if (owner === 'KU' || /\bku\b/.test(n) || n.includes('kuwait university')) return 'KU';
  if (
    owner === 'MOH' ||
    /adan|amiri|farwaniya|jaber|jahra|maternity|razi|zain|moh/.test(n)
  ) {
    return 'MOH';
  }
  if (owner === 'O2' || owner === 'OXYGEN' || n.includes('oxygen') || /\bo2\b/.test(n)) {
    return 'O2';
  }
  return 'OTHER';
}

export function footfallKind(loc: LocationReport): string {
  return loc.footfallDataKind || (loc.hasPeopleFootfall ? 'actual' : 'none');
}

export function matchesSegmentFilter(
  loc: LocationReport,
  segment: 'all' | OwnerSegment,
): boolean {
  if (segment === 'all') return true;
  return inferOwnerSegment(loc) === segment;
}

export function matchesFootfallFilter(
  loc: LocationReport,
  footfall: 'all' | 'actual' | 'projected',
): boolean {
  if (footfall === 'all') return true;
  const k = footfallKind(loc);
  if (footfall === 'actual') return k === 'actual' || k === 'mirrored';
  return k === 'projected';
}
