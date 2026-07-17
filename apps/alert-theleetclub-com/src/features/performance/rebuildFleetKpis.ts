import type {
  FleetKpis,
  FleetMachine,
  GrowthGroupKey,
  GrowthGroupSlice,
} from '@/features/performance/perfTypes';

function growthGroup(rows: FleetMachine[], compareKey: 'prevPeriodLocationKwd' | 'yoyPeriodLocationKwd'): GrowthGroupSlice {
  const period = rows.reduce((s, m) => s + (Number(m.totalLocationKwd) || 0), 0);
  const compare = rows.reduce((s, m) => s + (Number(m[compareKey]) || 0), 0);
  const ratePct = compare > 0 ? Math.round((period / compare) * 1000) / 10 : null;
  return {
    ratePct,
    periodKd: Math.round(period * 10000) / 10000,
    compareKd: Math.round(compare * 10000) / 10000,
    machineCount: rows.length,
    machines: rows.map((m) => {
      const cur = Number(m.totalLocationKwd) || 0;
      const cmp = Number(m[compareKey]) || 0;
      return {
        machineId: m.machineId,
        machineName: m.machineName,
        periodKd: Math.round(cur * 10000) / 10000,
        compareKd: Math.round(cmp * 10000) / 10000,
        ratePct: cmp > 0 ? Math.round((cur / cmp) * 1000) / 10 : null,
      };
    }),
  };
}

/** Rebuild All / Top5 / Lowest5 growth KPIs after batch-merging fleet machines. */
export function rebuildFleetKpis(machines: FleetMachine[], base?: FleetKpis | null): FleetKpis {
  const bySales = [...machines].sort(
    (a, b) => (b.totalLocationKwd || 0) - (a.totalLocationKwd || 0),
  );
  const top5 = bySales.slice(0, 5);
  const lowest5 = [...bySales].reverse().slice(0, 5);
  const keys: GrowthGroupKey[] = ['all', 'top5', 'lowest5'];
  const sets = { all: bySales, top5, lowest5 };
  const growthVsPrev: FleetKpis['growthVsPrev'] = {};
  const growthVsYoy: FleetKpis['growthVsYoy'] = {};
  for (const k of keys) {
    growthVsPrev[k] = growthGroup(sets[k], 'prevPeriodLocationKwd');
    growthVsYoy[k] = growthGroup(sets[k], 'yoyPeriodLocationKwd');
  }
  const periodActual = bySales.reduce((s, m) => s + (Number(m.totalLocationKwd) || 0), 0);
  const periodTarget = bySales.reduce((s, m) => s + (Number(m.periodTargetKd) || 0), 0);
  const withTgt = bySales.filter((m) => (Number(m.periodTargetKd) || 0) > 0);
  const hit = withTgt.filter(
    (m) => (Number(m.totalLocationKwd) || 0) >= (Number(m.periodTargetKd) || 0),
  ).length;
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
  };
}
