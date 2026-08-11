import type { HourRow } from './types';

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/** Footfall : cups colon ratio for heatmap cells (e.g. 4:2). */
export function footfallCupsColonRatio(h: HourRow): string {
  const cups = h.cupsCashless ?? h.cups;
  const ff = h.footfall;
  if (!(ff > 0) || !(cups > 0)) return '';
  const g = gcd(ff, cups);
  return `${Math.round(ff / g)}:${Math.round(cups / g)}`;
}
