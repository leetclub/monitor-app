import type { TodaySalesByMachine } from '@/features/footfall/lib/api';
import {
  dailyTargetKd,
  type AreaMachinePerf,
  type AreaPerfSummary,
} from '@/features/footfall/lib/areasPerformance';

export type MachineChartRow = AreaMachinePerf & {
  dailyTargetKd: number | null;
};

export function machineRowsFromSummaries(summaries: AreaPerfSummary[]): MachineChartRow[] {
  const rows: MachineChartRow[] = [];
  for (const area of summaries) {
    for (const m of area.machines) {
      rows.push({
        ...m,
        dailyTargetKd: dailyTargetKd(m.machineName, m.segment),
      });
    }
  }
  return rows;
}

export function sumDayRevenue(
  daySales: TodaySalesByMachine | undefined,
  machineIds: Iterable<string>,
): number {
  if (!daySales) return 0;
  let total = 0;
  for (const id of machineIds) {
    const row = daySales[id];
    if (!row) continue;
    if (row.revenueCashlessKd != null && row.revenueCashlessKd > 0) {
      total += row.revenueCashlessKd;
    } else {
      total += row.revenueKd ?? 0;
    }
  }
  return total;
}

export function totalDailyTargetKd(rows: MachineChartRow[]): number {
  return rows.reduce((s, r) => s + (r.dailyTargetKd ?? 0), 0);
}
