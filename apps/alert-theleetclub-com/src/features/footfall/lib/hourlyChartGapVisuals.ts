import type { HourRow } from '@/features/footfall/lib/types';
import { formatCups } from '@/features/footfall/lib/formatCups';

/** Merge consecutive weak-conversion hours into wider red bands (easier to spot). */
export function weakConversionMarkAreas(
  hours: HourRow[],
): { xAxis: string }[][] {
  const out: { xAxis: string }[][] = [];
  let start: string | null = null;
  let prev: string | null = null;

  for (const h of hours) {
    if (!h.isWeakConversion) {
      if (start && prev) out.push([{ xAxis: start }, { xAxis: prev }]);
      start = null;
      prev = null;
      continue;
    }
    if (!start) start = h.label;
    prev = h.label;
  }
  if (start && prev) out.push([{ xAxis: start }, { xAxis: prev }]);
  return out;
}

export function gapHourMarkAreas(hours: HourRow[]): { xAxis: string }[][] {
  return hours
    .filter((h) => h.upliftCups > 0)
    .map((h) => [{ xAxis: h.label }, { xAxis: h.label }]);
}

type EChartsLabelParam = { dataIndex: number };

/** Missed cups badge above the target band — integer only. */
export function hourGapCalloutLabel(hours: HourRow[]): (p: unknown) => string {
  return (p: unknown) => {
    const i = (p as EChartsLabelParam).dataIndex;
    const h = hours[i];
    if (!h || h.upliftCups <= 0) return '';
    return `{gap|+${formatCups(h.upliftCups)}}`;
  };
}
