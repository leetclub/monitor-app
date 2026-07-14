export type MachineRow = { id: string; name: string };

export type PerfDay = {
  date: string;
  weekday?: string;
  locationKwd: number;
  productCups: number;
  locationTargetKd?: number | null;
  productTargetCups?: number | null;
  locationGrowthPct?: number | null;
  productGrowthPct?: number | null;
  locationPctOfTarget?: number | null;
  productPctOfTarget?: number | null;
};

export type FleetMachine = {
  machineId: string;
  machineName: string;
  totalLocationKwd: number;
  periodTargetKd?: number | null;
  periodPctOfTarget?: number | null;
  locationSxPct?: number | null;
  days: PerfDay[];
};

export type FleetPayload = {
  historyDays?: number;
  machineCount?: number;
  machines?: FleetMachine[];
  aggregateDays?: PerfDay[];
  error?: string;
};

export const SERIES_PALETTE = [
  '#2dd4bf',
  '#38bdf8',
  '#a78bfa',
  '#f59e0b',
  '#f472b6',
  '#34d399',
  '#fb7185',
  '#60a5fa',
  '#c084fc',
  '#fbbf24',
  '#4ade80',
  '#e879f9',
];

export function pctColor(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '#94a3b8';
  if (pct >= 100) return '#15803d';
  if (pct >= 75) return '#1d4ed8';
  if (pct >= 50) return '#b45309';
  return '#dc2626';
}
