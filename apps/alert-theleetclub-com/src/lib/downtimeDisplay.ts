/** Format operational downtime seconds for Alert metric boxes. */
export function formatDowntimeSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '0m';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export type DowntimeMachineRow = {
  todaySec?: number | null;
  periodSec?: number | null;
};

export type DowntimeSummaryResponse = {
  ok?: boolean;
  labelToday?: string | null;
  labelPeriod?: string | null;
  byMachineId?: Record<string, DowntimeMachineRow>;
};
