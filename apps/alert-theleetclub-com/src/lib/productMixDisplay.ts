/** Product mix helpers for Red Flags drink extremes + Performance machine products. */

export type ProductNameCount = {
  name?: string | null;
  count?: number | null;
  cups?: number | null;
};

export type MachineProductRow = {
  name: string;
  cups: number;
  prevCups?: number | null;
  yoyCups?: number | null;
  trendPct?: number | null;
  yoyTrendPct?: number | null;
};

export type MachineProductGrain = {
  label?: string;
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

export function productCups(p: ProductNameCount | MachineProductRow | null | undefined): number {
  if (!p) return 0;
  if ('cups' in p && p.cups != null && Number.isFinite(Number(p.cups))) return Number(p.cups);
  const count = 'count' in p ? p.count : null;
  if (count != null && Number.isFinite(Number(count))) return Number(count);
  return 0;
}

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
