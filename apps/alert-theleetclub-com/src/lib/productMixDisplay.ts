/** Product mix helpers — ranked by sales revenue (KD); cups secondary. */

export type ProductNameCount = {
  name?: string | null;
  count?: number | null;
  cups?: number | null;
  revenueKwd?: number | null;
};

export type MachineProductRow = {
  name: string;
  revenueKwd: number;
  prevRevenueKwd?: number | null;
  yoyRevenueKwd?: number | null;
  cups?: number | null;
  /** @deprecated prefer revenueKwd — kept for older API payloads */
  prevCups?: number | null;
  yoyCups?: number | null;
  trendPct?: number | null;
  yoyTrendPct?: number | null;
};

export type MachineProductGrain = {
  label?: string;
  metric?: string;
  window?: {
    start?: string;
    end?: string;
    prevStart?: string;
    prevEnd?: string;
    yoyStart?: string;
    yoyEnd?: string;
  };
  products?: MachineProductRow[];
  top5?: ProductNameCount[];
  lowest5?: ProductNameCount[];
  top5Yoy?: ProductNameCount[];
  yoyCompare?: Array<{
    name?: string | null;
    revenueKwd?: number | null;
    yoyRevenueKwd?: number | null;
    cups?: number | null;
    yoyCups?: number | null;
    yoyTrendPct?: number | null;
  }>;
};

export type MachineProductsResponse = {
  ok?: boolean;
  machineId?: string;
  machineName?: string;
  asOf?: string;
  byGrain?: Partial<Record<'day' | 'week' | 'month', MachineProductGrain>>;
  error?: string;
};

export function productDisplayName(p: ProductNameCount | MachineProductRow | null | undefined): string {
  return String(p?.name || '').trim();
}

export function productRevenueKwd(p: ProductNameCount | MachineProductRow | null | undefined): number {
  if (!p) return 0;
  if ('revenueKwd' in p && p.revenueKwd != null && Number.isFinite(Number(p.revenueKwd))) {
    return Number(p.revenueKwd);
  }
  return 0;
}

export function productCups(p: ProductNameCount | MachineProductRow | null | undefined): number {
  if (!p) return 0;
  if ('cups' in p && p.cups != null && Number.isFinite(Number(p.cups))) return Number(p.cups);
  const count = 'count' in p ? p.count : null;
  if (count != null && Number.isFinite(Number(count))) return Number(count);
  return 0;
}

/** RF popup: names only, already ordered by revenue on the API. */
export function namesOnlyList(items: ProductNameCount[] | null | undefined, limit = 5): string[] {
  const out: string[] = [];
  for (const p of items || []) {
    const n = productDisplayName(p);
    if (!n) continue;
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

export function formatCupsN(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return String(Math.round(Number(n)));
}

/** Normalize API product row (revenue-first, with cups fallback for old payloads). */
export function normalizeProductRow(p: Record<string, unknown> | MachineProductRow): MachineProductRow {
  const name = String((p as { name?: string }).name || '').trim();
  const revenueKwd = Number((p as { revenueKwd?: number }).revenueKwd ?? 0);
  const prevRevenueKwd =
    (p as { prevRevenueKwd?: number | null }).prevRevenueKwd ??
    (p as { prevCups?: number | null }).prevCups ??
    null;
  const yoyRevenueKwd =
    (p as { yoyRevenueKwd?: number | null }).yoyRevenueKwd ??
    (p as { yoyCups?: number | null }).yoyCups ??
    null;
  return {
    name,
    revenueKwd: Number.isFinite(revenueKwd) ? revenueKwd : 0,
    prevRevenueKwd: prevRevenueKwd != null && Number.isFinite(Number(prevRevenueKwd)) ? Number(prevRevenueKwd) : null,
    yoyRevenueKwd: yoyRevenueKwd != null && Number.isFinite(Number(yoyRevenueKwd)) ? Number(yoyRevenueKwd) : null,
    cups: (p as { cups?: number | null }).cups ?? (p as { count?: number | null }).count ?? null,
    trendPct: (p as { trendPct?: number | null }).trendPct ?? null,
    yoyTrendPct: (p as { yoyTrendPct?: number | null }).yoyTrendPct ?? null,
  };
}
