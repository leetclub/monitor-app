import type { HourRow } from '@/features/footfall/lib/types';
import { formatCups } from '@/features/footfall/lib/formatCups';

type EChartsLabelParam = { dataIndex: number };

/** Show fewer on-chart hour labels when the day has many slots. */
export function shouldShowHourLabel(index: number, total: number): boolean {
  if (total <= 8) return true;
  if (total <= 14) return index % 2 === 0;
  return index % 3 === 0;
}

export const HOUR_LABEL_LAYOUT = {
  hideOverlap: true,
  moveOverlap: 'shiftY' as const,
};

export function hourSoldLabel(hours: HourRow[]): (p: unknown) => string {
  return (p: unknown) => {
    const i = (p as EChartsLabelParam).dataIndex;
    if (!shouldShowHourLabel(i, hours.length)) return '';
    const h = hours[i];
    if (!h || h.cups <= 0) return '';
    return formatCups(h.cups);
  };
}

export function hourGapLabel(hours: HourRow[]): (p: unknown) => string {
  return (p: unknown) => {
    const i = (p as EChartsLabelParam).dataIndex;
    const h = hours[i];
    if (!h || h.upliftCups <= 0) return '';
    return `+${formatCups(h.upliftCups)}`;
  };
}

/** Clean number above the sold bar — white with outline, no badge box. */
export function soldBarLabelStyle(nightMode: boolean) {
  return {
    show: true,
    position: 'top' as const,
    distance: nightMode ? 10 : 8,
    fontSize: nightMode ? 14 : 13,
    fontWeight: 700 as const,
    color: nightMode ? '#ffffff' : '#ffffff',
    textBorderColor: nightMode ? 'rgba(0, 0, 0, 0.85)' : 'rgba(26, 95, 143, 0.9)',
    textBorderWidth: 2,
    labelLayout: HOUR_LABEL_LAYOUT,
    ...(nightMode
      ? {
          textShadowColor: 'rgba(57, 255, 200, 0.85)',
          textShadowBlur: 12,
        }
      : {}),
  };
}

/** Missed cups above target band — magenta glow in night mode. */
export function gapBarLabelStyle(nightMode: boolean) {
  return {
    show: true,
    position: 'top' as const,
    distance: nightMode ? 16 : 12,
    fontSize: nightMode ? 13 : 12,
    fontWeight: 700 as const,
    color: nightMode ? '#ff6ec7' : '#c0392b',
    textBorderColor: nightMode ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.95)',
    textBorderWidth: 2,
    labelLayout: HOUR_LABEL_LAYOUT,
    ...(nightMode
      ? {
          textShadowColor: 'rgba(255, 51, 102, 0.9)',
          textShadowBlur: 14,
        }
      : {}),
  };
}
