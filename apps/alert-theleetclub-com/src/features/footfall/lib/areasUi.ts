import type { OwnerSegment } from '@/features/footfall/lib/types';

export type AchievementStatus = 'achieved' | 'on-track' | 'at-risk' | 'behind' | 'none';

export function fmtKd(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '—';
  return decimals > 0 ? `${n.toFixed(decimals)} KD` : `${Math.round(n)} KD`;
}

export function pctColor(pct: number | null): string {
  if (pct == null) return '#94a3b8';
  if (pct >= 100) return '#15803d';
  if (pct >= 75) return '#1d4ed8';
  if (pct >= 50) return '#b45309';
  return '#dc2626';
}

export function achievementStatus(pct: number | null): AchievementStatus {
  if (pct == null) return 'none';
  if (pct >= 100) return 'achieved';
  if (pct >= 75) return 'on-track';
  if (pct >= 50) return 'at-risk';
  return 'behind';
}

export const STATUS_LABEL: Record<AchievementStatus, string> = {
  achieved: 'Achieved',
  'on-track': 'On track',
  'at-risk': 'At risk',
  behind: 'Behind',
  none: 'No target',
};

export const SEGMENT_LABEL: Record<OwnerSegment, string> = {
  KU: 'KU',
  MOH: 'MOH',
  O2: 'O2',
  OTHER: 'Other',
};

export function segmentPillClass(segment: OwnerSegment): string {
  return `areasSegPill areasSegPill-${segment}`;
}

export function gapKd(actual: number, target: number): number {
  return actual - target;
}

export function fmtGap(actual: number, target: number): string {
  const g = gapKd(actual, target);
  if (g === 0) return 'On target';
  const sign = g > 0 ? '+' : '';
  return `${sign}${fmtKd(g)}`;
}
