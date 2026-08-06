/** Downtime formatting + detail API types. */

export function formatDowntimeSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '0m';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Signed % change today vs compare period (more downtime = positive). */
export function formatDowntimeTrendPct(pct: number): string {
  const n = Number(pct);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const body = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${body}%`;
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
