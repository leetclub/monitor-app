import type {
  FleetKpis,
  FleetMachine,
  GrowthGroupKey,
  GrowthGroupSlice,
} from '@/features/performance/perfTypes';
import {
  fleetPeriodKd,
  pickLowest5,
  pickTop5,
  shareOfFleetPct,
  sortMachinesBySales,
} from '@/features/performance/fleetRanking';

function growthGroup(
  rows: FleetMachine[],
  compareKey: 'prevPeriodLocationKwd' | 'yoyPeriodLocationKwd',
  fleetTotal: number,
): GrowthGroupSlice {
  const period = rows.reduce((s, m) => s + (Number(m.totalLocationKwd) || 0), 0);
  const compare = rows.reduce((s, m) => s + (Number(m[compareKey]) || 0), 0);
  const ratePct = compare > 0 ? Math.round((period / compare) * 1000) / 10 : null;
  return {
    ratePct,
    periodKd: Math.round(period * 10000) / 10000,
    compareKd: Math.round(compare * 10000) / 10000,
    machineCount: rows.length,
    shareOfFleetPct: shareOfFleetPct(period, fleetTotal),
    machines: rows.map((m) => {
      const cur = Number(m.totalLocationKwd) || 0;
      const cmp = Number(m[compareKey]) || 0;
      return {
        machineId: m.machineId,
        machineName: m.machineName,
        periodKd: Math.round(cur * 10000) / 10000,
        compareKd: Math.round(cmp * 10000) / 10000,
        ratePct: cmp > 0 ? Math.round((cur / cmp) * 1000) / 10 : null,
        shareOfFleetPct: shareOfFleetPct(cur, fleetTotal),
      };
    }),
  };
}

/** Rebuild All / Top5 / Lowest5 growth KPIs after batch-merging fleet machines. */
export function rebuildFleetKpis(machines: FleetMachine[], base?: FleetKpis | null): FleetKpis {
  const bySales = sortMachinesBySales(machines);
  const fleetTotal = fleetPeriodKd(bySales);
  const top5 = pickTop5(bySales);
  const lowest5 = pickLowest5(bySales);
  const keys: GrowthGroupKey[] = ['all', 'top5', 'lowest5'];
  const sets = { all: bySales, top5, lowest5 };
  const growthVsPrev: FleetKpis['growthVsPrev'] = {};
  const growthVsYoy: FleetKpis['growthVsYoy'] = {};
  for (const k of keys) {
    growthVsPrev[k] = growthGroup(sets[k], 'prevPeriodLocationKwd', fleetTotal);
    growthVsYoy[k] = growthGroup(sets[k], 'yoyPeriodLocationKwd', fleetTotal);
  }
  const periodActual = fleetTotal;
  const periodTarget = bySales.reduce((s, m) => s + (Number(m.periodTargetKd) || 0), 0);
  const withTgt = bySales.filter((m) => (Number(m.periodTargetKd) || 0) > 0);
  const hit = withTgt.filter(
    (m) => (Number(m.totalLocationKwd) || 0) >= (Number(m.periodTargetKd) || 0),
  ).length;
  const ytdThis = bySales.reduce((s, m) => s + (Number(m.ytdLocationKwd) || 0), 0);
  const ytdLy = bySales.reduce((s, m) => s + (Number(m.ytdLyLocationKwd) || 0), 0);
  const ytdCompare =
    bySales.some((m) => m.ytdLocationKwd != null || m.ytdLyLocationKwd != null)
      ? {
          ratePct: ytdLy > 0 ? Math.round((ytdThis / ytdLy) * 1000) / 10 : null,
          periodKd: Math.round(ytdThis * 10000) / 10000,
          compareKd: Math.round(ytdLy * 10000) / 10000,
          thisStart: base?.ytdCompare?.thisStart,
          thisEnd: base?.ytdCompare?.thisEnd,
          lastStart: base?.ytdCompare?.lastStart,
          lastEnd: base?.ytdCompare?.lastEnd,
        }
      : base?.ytdCompare ?? null;
  return {
    ...(base || {}),
    periodActualKd: Math.round(periodActual * 10000) / 10000,
    periodTargetKd: periodTarget > 0 ? Math.round(periodTarget * 10000) / 10000 : null,
    deficitKd: periodTarget > 0 ? Math.round((periodActual - periodTarget) * 10000) / 10000 : null,
    machinesWithTarget: withTgt.length,
    machinesOnTarget: hit,
    achievementRatePct: withTgt.length ? Math.round((hit / withTgt.length) * 1000) / 10 : null,
    growthRatePct: growthVsPrev.all?.ratePct ?? null,
    prevPeriodActualKd: growthVsPrev.all?.compareKd ?? null,
    yoyGrowthRatePct: growthVsYoy.all?.ratePct ?? null,
    yoyPeriodActualKd: growthVsYoy.all?.compareKd ?? null,
    growthVsPrev,
    growthVsYoy,
    ytdCompare,
  };
}
