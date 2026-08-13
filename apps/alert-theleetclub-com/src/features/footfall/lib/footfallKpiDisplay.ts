import type { LocationReport } from '@/features/footfall/lib/types';
import { alignedDayRows } from '@/features/footfall/lib/daysBreakdown';
import { ffMetricColors } from '@/features/footfall/lib/ffMetricColors';
import {
  footfallPerDayLabel,
  footfallPeriodLabel,
  footfallSourceKind,
  isMirroredFootfall,
  mirroredPeerName,
} from '@/features/footfall/lib/footfallLabel';
import { displayFootfallTotal } from '@/features/footfall/lib/footfallMetrics';

export function footfallPeriodTotal(loc: LocationReport): number {
  return loc.daily.projectedFootfall ?? loc.daily.totalFootfall ?? 0;
}

export function footfallPerDayAverage(loc: LocationReport): number | null {
  if (footfallSourceKind(loc) === 'none') return null;

  const periodTotal = footfallPeriodTotal(loc);

  if (
    loc.uniqueAdjusted &&
    !isMirroredFootfall(loc) &&
    loc.uniqueFootfallBreakdown
  ) {
    return loc.uniqueFootfallBreakdown.uniqueAvgPerDay;
  }
  if (loc.daily.avgDailyFootfall != null) return loc.daily.avgDailyFootfall;
  if (periodTotal > 0) return periodTotal / 5;
  return null;
}

export type FootfallKpiCopy = {
  periodLabel: string;
  periodHint?: string;
  periodValueColor?: string;
  perDayLabel?: string;
  perDayValueColor?: string;
  isNone: boolean;
  isMirroredOrProjected: boolean;
  kuEstimated?: boolean;
};

export function footfallKpiCopy(loc: LocationReport): FootfallKpiCopy {
  const c = ffMetricColors();
  const src = footfallSourceKind(loc);
  const peer = mirroredPeerName(loc);

  if (src === 'none') {
    return {
      periodLabel: footfallPeriodLabel(loc),
      periodHint: 'No camera and no peer in segment',
      periodValueColor: c.none,
      isNone: true,
      isMirroredOrProjected: false,
    };
  }

  if (src === 'mirrored') {
    return {
      periodLabel: footfallPeriodLabel(loc),
      periodHint: peer
        ? `No camera · mirrored from ${peer}`
        : 'No camera · cups ÷ segment benchmark',
      periodValueColor: loc.mirrorDisplay?.color ?? loc.footfallDisplay?.color ?? c.mirror,
      perDayLabel: footfallPerDayLabel(loc),
      perDayValueColor: loc.mirrorDisplay?.color ?? loc.footfallDisplay?.color ?? c.mirror,
      isNone: false,
      isMirroredOrProjected: true,
      kuEstimated: Boolean(loc.kuFootfallEstimate),
    };
  }

  return {
    periodLabel: footfallPeriodLabel(loc),
    periodHint: loc.uniqueAdjusted
      ? 'Camera adjusted for repeat visitors vs segment benchmark'
      : 'Camera detections (unique visitors)',
    periodValueColor: c.unique,
    perDayLabel: footfallPerDayLabel(loc),
    perDayValueColor: c.unique,
    isNone: false,
    isMirroredOrProjected: false,
  };
}

export function footfallForTargets(loc: LocationReport): number {
  return displayFootfallTotal(loc);
}

export function footfallSourceSummary(loc: LocationReport, copy: FootfallKpiCopy): string {
  if (copy.isNone) {
    return 'No footfall — no camera and no peer in this segment.';
  }

  const total = Math.round(footfallPeriodTotal(loc)).toLocaleString();
  const perDay = footfallPerDayAverage(loc);
  const perDayStr =
    perDay != null && Number.isFinite(perDay)
      ? ` · ≈ ${Math.round(perDay).toLocaleString()} / day`
      : '';

  if (isMirroredFootfall(loc)) {
    const peer = mirroredPeerName(loc);
    return peer
      ? `Mirrored footfall: ${total} (5 days)${perDayStr} · ${peer}`
      : `Mirrored footfall: ${total} (5 days)${perDayStr}`;
  }

  return `Unique footfall: ${total} (5 days)${perDayStr}`;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

export function footfallModalDetails(
  loc: LocationReport,
  copy: FootfallKpiCopy,
  hideDateLabels?: boolean,
): string[] {
  if (copy.isNone) {
    return ['Footfall and conversion targets stay at zero until a camera or peer source exists.'];
  }

  const lines: string[] = [];
  const periodTotal = footfallPeriodTotal(loc);
  const perDay = footfallPerDayAverage(loc);

  lines.push(`Period total: ${Math.round(periodTotal).toLocaleString()} over 5 business days.`);
  if (perDay != null && Number.isFinite(perDay)) {
    lines.push(`Average per business day: ${Math.round(perDay).toLocaleString()}.`);
  }

  const dayRows = alignedDayRows(loc.daysBreakdown);
  const footfallDays = dayRows.filter((r) => r.date && (r.footfall > 0 || r.footfallEstimated));
  if (footfallDays.length > 0) {
    lines.push('Daily footfall:');
    footfallDays.forEach((row, i) => {
      const tag = row.footfallEstimated ? ' (mirrored)' : '';
      const dayLabel = hideDateLabels
        ? (WEEKDAY_LABELS[i] ?? `Day ${i + 1}`)
        : row.date;
      lines.push(`  ${dayLabel}: ${Math.round(row.footfall).toLocaleString()}${tag}`);
    });
  }

  if (isMirroredFootfall(loc)) {
    const peer = mirroredPeerName(loc);
    if (peer) lines.push(`Mirrored from: ${peer}.`);
    if (loc.mirrorDisplay?.text) lines.push(loc.mirrorDisplay.text);
    if (loc.kuFootfallEstimate?.method) lines.push(loc.kuFootfallEstimate.method);
    else if (loc.footfallDisplay?.label) lines.push(loc.footfallDisplay.label);
  } else if (loc.uniqueFootfallBreakdown) {
    const b = loc.uniqueFootfallBreakdown;
    lines.push(
      `Raw camera detections: ${Math.round(b.rawDetections).toLocaleString()} → unique ${Math.round(b.uniqueEstimate).toLocaleString()} (×${b.factor.toFixed(2)} calibration).`,
    );
    if (b.netSignalMissing) {
      lines.push('Net in/out signal missing — floor not applied.');
    } else if (b.floorActive || b.ceilingActive) {
      const parts: string[] = [];
      if (b.floorActive) parts.push('floor active');
      if (b.ceilingActive) parts.push('ceiling active');
      lines.push(`Adjustment: ${parts.join(', ')}.`);
    }
  } else if (loc.rawFootfallTotal != null && loc.rawFootfallTotal > 0) {
    lines.push(
      `Camera detections (raw): ${Math.round(loc.rawFootfallTotal).toLocaleString()}${
        loc.rawAvgDailyFootfall != null
          ? ` (≈ ${Math.round(loc.rawAvgDailyFootfall).toLocaleString()} / day)`
          : ''
      }.`,
    );
  }

  if (loc.daily.conversionNote) {
    lines.push(loc.daily.conversionNote);
  }

  if (loc.footfallDiagnostics?.footfallPeriodNote) {
    lines.push(loc.footfallDiagnostics.footfallPeriodNote);
  }

  return lines;
}
