import type { AreaOwnerRow, TargetMachineRow } from '@/features/footfall/lib/areaOwnersApi';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import type { LocationReport, OwnerSegment } from '@/features/footfall/lib/types';
import {
  targetRevenuePerDay,
  weekRevenueTargetKdRounded,
} from '@/features/footfall/lib/weekRevenueTarget';

export type MachineWeekSales = {
  revenueCashlessKd?: number;
  revenueKd?: number;
};

export type AreaMachinePerf = {
  machineId: string;
  machineName: string;
  segment: OwnerSegment;
  weekTargetKd: number | null;
  weekActualKd: number;
  weekPct: number | null;
};

export type AreaPerfSummary = {
  vendonUserId: string;
  vendonUserName: string;
  machineCount: number;
  weekTargetKd: number;
  weekActualKd: number;
  weekPct: number | null;
  machines: AreaMachinePerf[];
};

function machineRevenueKd(row: MachineWeekSales | undefined): number {
  if (!row) return 0;
  if (row.revenueCashlessKd != null && row.revenueCashlessKd > 0) {
    return row.revenueCashlessKd;
  }
  return row.revenueKd ?? 0;
}

export function buildAreaPerformance(
  areas: AreaOwnerRow[],
  machineCatalog: TargetMachineRow[],
  salesByMachine: Record<string, MachineWeekSales>,
): AreaPerfSummary[] {
  const nameById = new Map(machineCatalog.map((m) => [m.id, m.name]));

  return areas.map((area) => {
    const machines: AreaMachinePerf[] = area.machineIds.map((mid) => {
      const machineName = nameById.get(mid) ?? mid;
      const stub = { machineId: mid, locationName: machineName } as LocationReport;
      const segment = inferOwnerSegment(stub);
      const weekTargetKd = weekRevenueTargetKdRounded(machineName);
      const weekActualKd = machineRevenueKd(salesByMachine[mid]);
      const weekPct =
        weekTargetKd != null && weekTargetKd > 0
          ? Math.round((weekActualKd / weekTargetKd) * 10000) / 100
          : null;
      return {
        machineId: mid,
        machineName,
        segment,
        weekTargetKd,
        weekActualKd,
        weekPct,
      };
    });

    const weekTargetKd = machines.reduce((s, m) => s + (m.weekTargetKd ?? 0), 0);
    const weekActualKd = machines.reduce((s, m) => s + m.weekActualKd, 0);
    const weekPct =
      weekTargetKd > 0
        ? Math.round((weekActualKd / weekTargetKd) * 10000) / 100
        : null;

    return {
      vendonUserId: area.vendonUserId,
      vendonUserName: area.vendonUserName,
      machineCount: machines.length,
      weekTargetKd,
      weekActualKd,
      weekPct,
      machines,
    };
  });
}

export function dailyTargetKd(machineName: string, segment: OwnerSegment): number | null {
  const week = weekRevenueTargetKdRounded(machineName);
  return week != null ? targetRevenuePerDay(week, segment) : null;
}
