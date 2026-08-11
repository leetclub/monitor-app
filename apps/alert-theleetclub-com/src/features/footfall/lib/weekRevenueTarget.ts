import targets from '@/features/footfall/lib/weekRevenueTargets.json';
import type { OwnerSegment } from '@/features/footfall/lib/types';

export const TRAJECTORY_CUP_PRICE_KD = 0.8;

/** KU business week is 5 days (Sun–Thu); hospital/O2 use 7. */
export function targetBusinessDaysForSegment(segment: OwnerSegment): number {
  return segment === 'KU' ? 5 : 7;
}

type WeekTargetRow = { name: string; weekTargetKd: number };

const ALIASES: Record<string, string> = {
  'jaber gate 2': 'Jaber Hospital - Gate 2',
  'jaber hospital gate 2': 'Jaber Hospital - Gate 2',
  'jaber gate 6': 'Jaber Hospital - Gate 6',
  'jaber hospital gate 6': 'Jaber Hospital - Gate 6',
  'jahra hospital main gate': 'Jahra Hospital - Main Gate',
  'jahra hospital parking': 'Jahra Hospital - Parking',
  'jahra women center': 'Jahra Women center',
  'ku engineering': 'KU Enginnering',
  'ku engineering j': 'KU Enginnering',
  'adan main gate': 'Adan Main Gate',
  'adan maternity': 'Adan maternity',
  'maternity hospital main': 'Maternity Hospital Main',
  'moh main building': 'MOH main',
  'farwaniya main gate': 'Farwaniya Main gate',
  'amiri hospital new': 'Amiri New',
  'amiri old 2': 'Amiri old 2',
  'sultan hamra': 'Sultan Hamra',
  'sultan hamra hospital': 'Sultan Hamra',
};

function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const byNorm = new Map<string, WeekTargetRow>();
for (const row of targets as WeekTargetRow[]) {
  byNorm.set(normKey(row.name), row);
}

export function weekRevenueTargetKd(locationName: string): number | null {
  const key = normKey(locationName);
  const alias = ALIASES[key];
  if (alias) {
    const hit = byNorm.get(normKey(alias));
    if (hit) return hit.weekTargetKd;
  }
  const exact = byNorm.get(key);
  if (exact) return exact.weekTargetKd;

  let best: WeekTargetRow | null = null;
  let bestLen = 0;
  for (const row of targets as WeekTargetRow[]) {
    const nk = normKey(row.name);
    if (key.includes(nk) || nk.includes(key)) {
      const len = Math.min(key.length, nk.length);
      if (len > bestLen) {
        bestLen = len;
        best = row;
      }
    }
  }
  return best?.weekTargetKd ?? null;
}

/** Whole KD — sheet values are rounded for display and target math. */
export function weekRevenueTargetKdRounded(locationName: string): number | null {
  const raw = weekRevenueTargetKd(locationName);
  return raw != null ? Math.round(raw) : null;
}

export function targetRevenuePerDay(
  weekTargetKd: number,
  segment: OwnerSegment = 'OTHER',
): number {
  const days = targetBusinessDaysForSegment(segment);
  return Math.round(weekTargetKd / days);
}

export function targetCupsPerDayFromRevenue(targetRevDay: number): number {
  if (TRAJECTORY_CUP_PRICE_KD <= 0) return 0;
  return targetRevDay / TRAJECTORY_CUP_PRICE_KD;
}
