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

export type GrowthGroupKey = 'all' | 'top5' | 'lowest5';

export type GrowthMachineRow = {
  machineId: string;
  machineName: string;
  periodKd: number;
  compareKd: number;
  ratePct?: number | null;
};

export type GrowthGroupSlice = {
  ratePct?: number | null;
  periodKd: number;
  compareKd: number;
  machineCount?: number;
  machines?: GrowthMachineRow[];
};

export type FleetMachine = {
  machineId: string;
  machineName: string;
  productName?: string | null;
  totalLocationKwd: number;
  periodTargetKd?: number | null;
  periodPctOfTarget?: number | null;
  totalProductCups?: number | null;
  periodProductTargetCups?: number | null;
  periodProductPctOfTarget?: number | null;
  locationSxPct?: number | null;
  productSxPct?: number | null;
  prevPeriodLocationKwd?: number | null;
  yoyPeriodLocationKwd?: number | null;
  ytdLocationKwd?: number | null;
  ytdLyLocationKwd?: number | null;
  prevPeriodGrowthPct?: number | null;
  yoyGrowthPct?: number | null;
  days: PerfDay[];
};

export type YtdCompareSlice = {
  ratePct?: number | null;
  periodKd: number;
  compareKd: number;
  thisStart?: string;
  thisEnd?: string;
  lastStart?: string;
  lastEnd?: string;
};

export type FleetKpis = {
  deficitKd?: number | null;
  periodActualKd?: number | null;
  periodTargetKd?: number | null;
  achievementRatePct?: number | null;
  machinesOnTarget?: number;
  machinesWithTarget?: number;
  growthRatePct?: number | null;
  prevPeriodActualKd?: number | null;
  yoyGrowthRatePct?: number | null;
  yoyPeriodActualKd?: number | null;
  growthVsPrev?: Partial<Record<GrowthGroupKey, GrowthGroupSlice>>;
  growthVsYoy?: Partial<Record<GrowthGroupKey, GrowthGroupSlice>>;
  /** Calendar YTD this year vs same dates last year. */
  ytdCompare?: YtdCompareSlice | null;
};

export type PerfPreset =
  | 'this_week'
  | 'last_week'
  | 'last_2_weeks'
  | 'this_month'
  | 'last_month'
  | 'today'
  | 'yesterday'
  | 'rolling';

export type PerfViewMode = 'all' | 'top5' | 'lowest5' | 'selected';

export type FleetPayload = {
  historyDays?: number;
  preset?: string;
  window?: {
    start?: string;
    end?: string;
    prevStart?: string;
    prevEnd?: string;
    yoyStart?: string;
    yoyEnd?: string;
  };
  includeProducts?: boolean;
  machineCount?: number;
  productName?: string | null;
  productNames?: string[];
  machines?: FleetMachine[];
  aggregateDays?: PerfDay[];
  kpis?: FleetKpis;
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
