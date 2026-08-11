/**
 * Sales-target segments. Each segment is a closed list of recommended week(s).
 * Sales managers pick a segment; the date window is fixed (no date picker).
 */
import type { LocationReport, OwnerSegment } from './types';
import { inferOwnerSegment } from './ownerSegment';

export type SegmentId = 'ALL' | 'KU' | 'MOH' | 'O2';

export type ReportWindow = {
  /** Stable id used in URLs / caching. */
  id: string;
  /** "Sun 22 – Thu 26 Jun 2025" */
  label: string;
  /** "Jun 22 → Jun 26, 2025" */
  shortLabel: string;
  startDate: string;
  endDate: string;
};

export const WINDOW_KU_JUL: ReportWindow = {
  id: 'ku-jul06-2025',
  label: 'Sun 6 – Thu 10 Jul 2025',
  shortLabel: 'Jul 6 → Jul 10, 2025',
  startDate: '2025-07-06',
  endDate: '2025-07-10',
};

export const WINDOW_MOH_O2_MAY: ReportWindow = {
  id: 'moh-o2-may10-2026',
  label: 'Sun 10 – Thu 14 May 2026',
  shortLabel: 'May 10 → May 14, 2026',
  startDate: '2026-05-10',
  endDate: '2026-05-14',
};

export const WINDOWS = {
  KU_JUL: WINDOW_KU_JUL,
  MOH_O2_MAY: WINDOW_MOH_O2_MAY,
};

export type SegmentDef = {
  id: SegmentId;
  label: string;
  /** Short pill under the segment tab. */
  hint: string;
  /** Recommended report window(s). KU has two; MOH / O2 / ALL have one. */
  windows: ReportWindow[];
  /** Filter applied on top of the report's locations. */
  match: (loc: LocationReport, owner: OwnerSegment) => boolean;
};

export const SEGMENTS: SegmentDef[] = [
  {
    id: 'ALL',
    label: 'All locations',
    hint: 'All segments',
    windows: [WINDOW_KU_JUL, WINDOW_MOH_O2_MAY],
    match: () => true,
  },
  {
    id: 'KU',
    label: 'KU',
    hint: 'Campus locations',
    windows: [WINDOW_KU_JUL],
    match: (_loc, owner) => owner === 'KU',
  },
  {
    id: 'MOH',
    label: 'MOH',
    hint: 'Ministry hospitals',
    windows: [WINDOW_MOH_O2_MAY],
    match: (_loc, owner) => owner === 'MOH',
  },
  {
    id: 'O2',
    label: 'O2',
    hint: 'O2 venues',
    windows: [WINDOW_MOH_O2_MAY],
    match: (_loc, owner) => owner === 'O2',
  },
];

export function getSegment(id: SegmentId): SegmentDef {
  return SEGMENTS.find((s) => s.id === id) ?? SEGMENTS[0];
}

/** Default window used by the period-context bar / header. */
export function defaultWindowForSegment(id: SegmentId, _kuWindowId: string): ReportWindow {
  if (id === 'KU' || id === 'ALL') {
    return WINDOW_KU_JUL;
  }
  return WINDOW_MOH_O2_MAY;
}

/** The window a given location should use, given the current segment + KU pick. */
export function windowForLocation(loc: LocationReport, _kuWindowId: string): ReportWindow {
  const owner = inferOwnerSegment(loc);
  if (owner === 'KU') {
    return WINDOW_KU_JUL;
  }
  return WINDOW_MOH_O2_MAY;
}

/** Re-export for convenience. */
export { inferOwnerSegment };
