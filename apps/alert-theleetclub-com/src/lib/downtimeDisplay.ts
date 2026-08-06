/** Downtime formatting + detail API types. */

/** Format operational seconds for ops UI (shows seconds under 1 minute). */
export function formatDowntimeSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '0m';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remS = s % 60;
  if (h <= 0 && m <= 0) return `${remS}s`;
  if (h <= 0) return remS > 0 ? `${m}m ${remS}s` : `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Need ≥1 minute baseline before % change is meaningful. */
export const DOWNTIME_TREND_MIN_BASE_SEC = 60;

/** Signed % change today vs compare period (more downtime = positive). */
export function formatDowntimeTrendPct(pct: number): string {
  const n = Number(pct);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const body = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${body}%`;
}

/**
 * Operator-facing trend: avoid absurd % when yesterday is ~0 / sub-minute
 * (e.g. 3h20m vs 9s → +133711% while UI showed "0m").
 */
export function formatDowntimeTrendLabel(
  trendPct: number | null | undefined,
  todaySec: number,
  periodSec: number,
): { text: string; worse: boolean; better: boolean } | null {
  const t = Number.isFinite(todaySec) ? Math.max(0, todaySec) : 0;
  const p = Number.isFinite(periodSec) ? Math.max(0, periodSec) : 0;
  if (t <= 0 && p <= 0) return null;

  if (p < DOWNTIME_TREND_MIN_BASE_SEC) {
    if (t <= 0) return { text: 'flat', worse: false, better: false };
    const delta = Math.max(0, t - p);
    return {
      text: p <= 0 ? `new · +${formatDowntimeSec(t)}` : `+${formatDowntimeSec(delta)}`,
      worse: true,
      better: false,
    };
  }

  const pct =
    trendPct != null && Number.isFinite(Number(trendPct))
      ? Number(trendPct)
      : ((t - p) / p) * 100;
  if (!Number.isFinite(pct)) return null;
  // Cap display if somehow huge
  if (Math.abs(pct) >= 1000) {
    const delta = t - p;
    return {
      text: `${delta >= 0 ? '+' : '−'}${formatDowntimeSec(Math.abs(delta))}`,
      worse: delta > 0,
      better: delta < 0,
    };
  }
  return {
    text: formatDowntimeTrendPct(pct),
    worse: pct > 0,
    better: pct < 0,
  };
}

export type DowntimeMachineRow = {
  todaySec?: number | null;
  periodSec?: number | null;
  trendDeltaSec?: number | null;
  trendPct?: number | null;
};

export type DowntimeSummaryResponse = {
  ok?: boolean;
  labelToday?: string | null;
  labelPeriod?: string | null;
  sameElapsedCompare?: boolean;
  byMachineId?: Record<string, DowntimeMachineRow>;
};

export type DowntimeLossBaseline = {
  id?: string;
  label?: string;
  date?: string | null;
  kwd?: number | null;
  elapsedSec?: number | null;
  kwdPerSec?: number | null;
  primary?: boolean;
};

export type DowntimeProjection = {
  baselineHourlyKwd?: number | null;
  downtimeHours?: number | null;
  peakMultiplier?: number | null;
  peakBand?: string | null;
  opportunityCostKwd?: number | null;
  spoilageKwd?: number | null;
  finalEconomicImpactKwd?: number | null;
  avgVendKwd?: number | null;
  volumeImpact?: number | null;
  formula?: string | null;
};

export type DowntimeEventRow = {
  eventType?: string;
  startAt?: string | null;
  endAt?: string | null;
  endAtEffective?: string | null;
  open?: boolean;
  wallSec?: number | null;
  operationalSec?: number | null;
  estimatedLossPrimaryKwd?: number | null;
  estimatedLossKwd?: Record<string, number | null | undefined>;
  observedSalesKwd?: Record<string, number | null | undefined>;
  peakMultiplier?: number | null;
  peakBand?: string | null;
  projection?: DowntimeProjection | null;
};

export type DowntimeDetailResponse = {
  ok?: boolean;
  error?: string;
  machineId?: string;
  machineName?: string;
  dateToday?: string;
  todayMergedOperationalSec?: number | null;
  yesterdaySameElapsedSec?: number | null;
  trendDeltaSec?: number | null;
  trendPct?: number | null;
  projection?: DowntimeProjection | null;
  baselineMissing?: boolean;
  estimatedLossTodayPrimaryKwd?: number | null;
  estimatedLossTodayKwd?: Record<string, number | null | undefined>;
  observedSalesTodayKwd?: Record<string, number | null | undefined>;
  lossMethod?: string | null;
  lossAlignedToClock?: boolean;
  baselines?: DowntimeLossBaseline[];
  events?: DowntimeEventRow[];
  liveEventsError?: string | null;
  peakBands?: Array<{ fromHour?: number; toHour?: number; multiplier?: number; label?: string }>;
  spoilageSource?: 'explicit_query' | 'monitor_waste' | 'none' | string;
  spoilageExplicit?: boolean;
  waste?: {
    wastePct?: number | null;
    wasteCups?: number | null;
    totalWaste?: number | null;
    totalSales?: number | null;
    avgVendKwd?: number | null;
    estimatedWasteKwd?: number | null;
    source?: string | null;
    note?: string | null;
    error?: string | null;
    skipped?: boolean;
    reason?: string | null;
  } | null;
};

export function formatDowntimeClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = String(iso).trim();
  // 2026-08-03T14:22:00+03:00 → 14:22
  const m = s.match(/T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  return s.slice(0, 16).replace('T', ' ');
}

export function formatLossKwd(kwd: number | null | undefined): string {
  if (kwd == null || !Number.isFinite(kwd)) return '—';
  const n = Number(kwd);
  if (Math.abs(n) < 0.005) return '0.00 KD';
  return `${n.toFixed(2)} KD`;
}

export function formatHourlyKwd(kwd: number | null | undefined): string {
  if (kwd == null || !Number.isFinite(kwd)) return '—';
  return `${Number(kwd).toFixed(2)} KD/h`;
}

export function formatPeakMult(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  return `×${Number(m).toFixed(2)}`;
}
