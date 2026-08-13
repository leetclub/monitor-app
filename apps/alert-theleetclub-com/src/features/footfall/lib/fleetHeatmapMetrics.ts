import type { VisualMapComponentOption } from 'echarts';
import type { HourRow, LocationReport } from '@/features/footfall/lib/types';
import { footfallSeriesLabel, footfallSourceShort } from '@/features/footfall/lib/footfallLabel';
import { footfallCupsColonRatio } from '@/features/footfall/lib/ratioLabel';

/** Classic heat + gap emphasis (matches hourly chart red stack). */
const HEAT_RED = ['#fff5f0', '#fcbba1', '#fc9272', '#ef6548', '#d7301f', '#990000'];
const HEAT_GAP = ['#fff8f6', '#fdd0c7', '#f4a099', '#e74c3c', '#c0392b', '#922b21'];
const SCALE_GOOD = ['#fff9e6', '#fde68a', '#a3e635', '#4d7c0f'];
const HEAT_RED_NIGHT = ['#3a1510', '#7f2318', '#c0392b', '#ef6548', '#fc9272', '#fecaca'];
const HEAT_GAP_NIGHT = ['#2a1210', '#7f1d1d', '#c0392b', '#e74c3c', '#f87171', '#fca5a5'];
const SCALE_GOOD_NIGHT = ['#1a2e14', '#3f6212', '#84cc16', '#d9f99d'];

export type FleetHeatmapMetric = 'shortfall' | 'footfall' | 'cups' | 'ratio' | 'net' | 'conversion';

export const FLEET_HEATMAP_METRICS: {
  id: FleetHeatmapMetric;
  label: string;
  short: string;
}[] = [
  { id: 'shortfall', label: 'Missed cups @ benchmark', short: 'Gap' },
  { id: 'footfall', label: 'Footfall · 5 days', short: 'Footfall' },
  { id: 'cups', label: 'Cups sold', short: 'Cups' },
  { id: 'ratio', label: 'Footfall : cups (e.g. 4:2)', short: 'Ratio' },
  { id: 'net', label: 'Net traffic (in − out)', short: 'Net' },
  { id: 'conversion', label: 'Conversion %', short: 'Conv %' },
];

export function fleetHasNetHourly(locations: LocationReport[]): boolean {
  return locations.some((l) =>
    (l.hours ?? []).some(
      (h) =>
        (h.peopleIn ?? 0) > 0 ||
        (h.peopleOut ?? 0) > 0 ||
        (h.netTraffic ?? 0) !== 0,
    ),
  );
}

export function fleetHasShortfallHourly(locations: LocationReport[]): boolean {
  return locations.some((l) => (l.hours ?? []).some((h) => (h.upliftCups ?? 0) > 0));
}

export function defaultFleetHeatmapMetric(
  _salesWeekOnly: boolean,
  locations: LocationReport[],
): FleetHeatmapMetric {
  if (fleetHasShortfallHourly(locations)) return 'shortfall';
  return 'footfall';
}

export function hourMetricValue(
  metric: FleetHeatmapMetric,
  h: HourRow,
  loc: LocationReport,
): number {
  switch (metric) {
    case 'shortfall':
      return h.upliftCups ?? 0;
    case 'cups':
      return h.cups;
    case 'ratio':
      if (h.footfall > 0 && h.cups > 0) return h.footfall / h.cups;
      return 0;
    case 'footfall':
      return h.footfall;
    case 'net':
      return h.netTraffic ?? (h.peopleIn ?? 0) - (h.peopleOut ?? 0);
    case 'conversion':
      if (h.conversionPct > 0) return h.conversionPct;
      if (h.footfall > 0 && h.cups > 0) return (h.cups / h.footfall) * 100;
      return loc.daily.conversionPct;
    default:
      return 0;
  }
}

export function formatHeatmapCellLabel(
  metric: FleetHeatmapMetric,
  value: number,
  h?: HourRow,
): string {
  if (metric === 'ratio' && h) return footfallCupsColonRatio(h);
  if (value === 0 || !Number.isFinite(value)) return '';
  if (metric === 'conversion') return `${Math.round(value)}`;
  const n = Math.round(value);
  if (Math.abs(n) >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

export function heatmapTooltipHtml(
  loc: LocationReport,
  h: HourRow,
  hourLabel: string,
  activeMetric: FleetHeatmapMetric,
): string {
  const ff = footfallSourceShort(loc);
  const net = h.netTraffic ?? (h.peopleIn ?? 0) - (h.peopleOut ?? 0);
  const hasNet = (h.peopleIn ?? 0) > 0 || (h.peopleOut ?? 0) > 0;
  const conv =
    h.footfall > 0 && h.cups > 0
      ? `${((h.cups / h.footfall) * 100).toFixed(1)}%`
      : `${h.conversionPct}%`;
  const missed = h.upliftCups ?? 0;

  const lines = [
    `<strong>${loc.locationName}</strong>`,
    `<span style="color:#94a3b8">${hourLabel}</span>`,
    `Cups: <b>${h.cups}</b> · Target: <b>${Math.round(h.aspiredCups)}</b>`,
    missed > 0
      ? `<span style="color:#c0392b">Missed @ benchmark: <b>+${missed} cups</b> (+${h.upliftKd.toFixed(2)} KD)</span>`
      : `<span style="color:#2e9e5a">At/above benchmark capture</span>`,
    `${footfallSeriesLabel(loc)}: <b>${Math.round(h.footfall).toLocaleString()}</b> <span style="color:#94a3b8">(${ff})</span>`,
  ];
  if (hasNet) {
    lines.push(
      `Net: <b>${Math.round(net).toLocaleString()}</b> · in ${h.peopleIn ?? 0} · out ${h.peopleOut ?? 0}`,
    );
  }
  lines.push(`Conversion: <b>${conv}</b>`);
  const activeLabel = FLEET_HEATMAP_METRICS.find((m) => m.id === activeMetric)?.label ?? '';
  lines.push(`<span style="color:#c0392b">Color: ${activeLabel}</span>`);
  return lines.join('<br/>');
}

export function heatmapTitle(metric: FleetHeatmapMetric, salesWeekOnly: boolean): string {
  switch (metric) {
    case 'shortfall':
      return 'Fleet heatmap — missed cups by hour (gap @ benchmark)';
    case 'cups':
      return 'Fleet heatmap — cups sold by hour';
    case 'ratio':
      return 'Fleet heatmap — footfall : cups ratio (e.g. 4:2)';
    case 'footfall':
      return 'Fleet heatmap — footfall intensity by hour';
    case 'net':
      return 'Fleet heatmap — net traffic (in − out) by hour';
    case 'conversion':
      return salesWeekOnly
        ? 'Fleet heatmap — conversion % (red = weak)'
        : 'Fleet heatmap — conversion % (red = weak)';
    default:
      return 'Fleet heatmap';
  }
}

export function heatmapSubtext(metric: FleetHeatmapMetric, salesWeekOnly: boolean): string {
  const base = 'Click a row to open the site';
  if (metric === 'shortfall') {
    return `${base} · red = missed sales`;
  }
  if (metric === 'footfall') {
    return `${base} · red = busier hours`;
  }
  if (metric === 'net') {
    return `${base} · red = outflow · green = inflow`;
  }
  if (metric === 'conversion') {
    return `${base} · red = low conversion · green = strong`;
  }
  if (metric === 'ratio') {
    return `${base} · cell shows footfall:cups (e.g. 4:2)`;
  }
  if (salesWeekOnly && metric === 'cups') {
    return `${base} · green scale · sales week`;
  }
  return base;
}

export function visualMapForMetric(
  metric: FleetHeatmapMetric,
  data: [number, number, number][],
  benchmarkPct: number,
  nightMode = false,
): VisualMapComponentOption {
  const values = data.map((d) => d[2]);
  const maxVal = Math.max(1, ...values.map((v) => Math.abs(v)));

  if (metric === 'shortfall') {
    return {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: nightMode ? HEAT_GAP_NIGHT : HEAT_GAP },
    };
  }

  if (metric === 'net') {
    const bound = Math.max(1, ...values.map((v) => Math.abs(v)));
    return {
      min: -bound,
      max: bound,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: nightMode ? ['#c0392b', '#334155', '#22c55e'] : ['#c0392b', '#f5f5f5', '#2e9e5a'] },
    };
  }

  if (metric === 'cups') {
    return {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: nightMode ? SCALE_GOOD_NIGHT : SCALE_GOOD },
    };
  }

  if (metric === 'footfall') {
    return {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: nightMode ? HEAT_RED_NIGHT : HEAT_RED },
    };
  }

  return {
    min: 0,
    max: Math.max(12, benchmarkPct * 2, maxVal),
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom: 0,
    inRange: {
      color: nightMode
        ? ['#7f1d1d', '#c2410c', '#ca8a04', '#4d7c0f', '#22c55e']
        : ['#c0392b', '#e67e22', '#f9e79f', '#aed581', '#2e9e5a'],
    },
  };
}
