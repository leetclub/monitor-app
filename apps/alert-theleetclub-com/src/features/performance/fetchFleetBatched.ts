import type { FleetMachine, FleetPayload, PerfDay } from '@/features/performance/perfTypes';
import { apiGet } from '@/lib/api';

const BATCH = 30;

function mergeDays(machines: FleetMachine[]): PerfDay[] {
  const byDate = new Map<string, PerfDay>();
  for (const m of machines) {
    for (const d of m.days || []) {
      const key = d.date;
      const cur = byDate.get(key);
      if (!cur) {
        byDate.set(key, {
          ...d,
          locationKwd: Number(d.locationKwd) || 0,
          productCups: Number(d.productCups) || 0,
          locationTargetKd: Number(d.locationTargetKd) || 0,
          productTargetCups: Number(d.productTargetCups) || 0,
        });
        continue;
      }
      cur.locationKwd = (Number(cur.locationKwd) || 0) + (Number(d.locationKwd) || 0);
      cur.productCups = (Number(cur.productCups) || 0) + (Number(d.productCups) || 0);
      cur.locationTargetKd =
        (Number(cur.locationTargetKd) || 0) + (Number(d.locationTargetKd) || 0);
      cur.productTargetCups =
        (Number(cur.productTargetCups) || 0) + (Number(d.productTargetCups) || 0);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Fetch fleet performance in batches so Select-all can cover the full machine list. */
export async function fetchFleetBatched(opts: {
  machineIds: string[];
  preset: string;
  includeProducts: boolean;
  /** Prefer display names from /api/alert/machines over raw IDs from fleet batches. */
  nameById?: Record<string, string>;
}): Promise<FleetPayload> {
  const ids = [...new Set(opts.machineIds.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) {
    return { machines: [], aggregateDays: [], machineCount: 0 };
  }

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    chunks.push(ids.slice(i, i + BATCH));
  }

  const parts = await Promise.all(
    chunks.map((chunk) => {
      const qs = new URLSearchParams();
      qs.set('preset', opts.preset);
      qs.set('includeProducts', opts.includeProducts ? '1' : '0');
      qs.set('machineIds', chunk.join(','));
      return apiGet<FleetPayload>(`/api/alert/performance/fleet?${qs.toString()}`);
    }),
  );

  const byId = new Map<string, FleetMachine>();
  for (const part of parts) {
    if (part.error && !part.machines?.length) {
      return { ...part, machines: [], aggregateDays: [] };
    }
    for (const m of part.machines || []) {
      byId.set(String(m.machineId), m);
    }
  }
  const nameById = opts.nameById || {};
  const machines = [...byId.values()]
    .map((m) => {
      const name = nameById[String(m.machineId)];
      return name ? { ...m, machineName: name } : m;
    })
    .sort(
      (a, b) =>
        (b.totalLocationKwd || 0) - (a.totalLocationKwd || 0) ||
        a.machineName.localeCompare(b.machineName),
    );
  const aggregateDays = mergeDays(machines);
  // Prefer richest KPI payload (last batch still has growth groups for its slice).
  // For full-fleet KPIs, UI uses machines; re-aggregate growth on client when needed.
  const base = parts.find((p) => p.kpis) || parts[0] || {};
  return {
    ...base,
    machines,
    aggregateDays,
    machineCount: machines.length,
    error: parts.map((p) => p.error).find(Boolean),
  };
}
