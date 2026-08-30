import type { FleetMachine } from '@/features/performance/perfTypes';

/** Sort machines by period location KD (high → low). */
export function sortMachinesBySales(machines: FleetMachine[]): FleetMachine[] {
  return [...machines].sort(
    (a, b) =>
      (Number(b.totalLocationKwd) || 0) - (Number(a.totalLocationKwd) || 0) ||
      String(a.machineName || '').localeCompare(String(b.machineName || '')),
  );
}

export function machinesWithSales(machines: FleetMachine[]): FleetMachine[] {
  return sortMachinesBySales(machines).filter((m) => (Number(m.totalLocationKwd) || 0) > 0);
}

export function pickTop5(machines: FleetMachine[]): FleetMachine[] {
  return sortMachinesBySales(machines).slice(0, 5);
}

/** Lowest 5 by period KD — excludes zero-sales machines (same rule as product mix). */
export function pickLowest5(machines: FleetMachine[]): FleetMachine[] {
  const withSales = machinesWithSales(machines);
  if (withSales.length <= 5) return [];
  const topIds = new Set(pickTop5(machines).map((m) => m.machineId));
  const pool = withSales.filter((m) => !topIds.has(m.machineId));
  return pool.slice(-5).reverse();
}

export function fleetPeriodKd(machines: FleetMachine[]): number {
  return machines.reduce((s, m) => s + (Number(m.totalLocationKwd) || 0), 0);
}

export function shareOfFleetPct(partKd: number, fleetTotalKd: number): number | null {
  if (!Number.isFinite(partKd) || !Number.isFinite(fleetTotalKd) || fleetTotalKd <= 0) return null;
  return Math.round((partKd / fleetTotalKd) * 1000) / 10;
}

export function sumPeriodKd(machines: FleetMachine[]): number {
  return Math.round(fleetPeriodKd(machines) * 10000) / 10000;
}
