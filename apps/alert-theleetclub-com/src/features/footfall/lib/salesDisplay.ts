import type { LocationReport, SalesDisplayMeta } from '@/features/footfall/lib/types';

export function salesDisplayFor(loc: LocationReport): SalesDisplayMeta | null {
  return loc.salesDisplay ?? null;
}

export function salesDataKind(loc: LocationReport): string {
  return loc.salesDataKind ?? loc.daily.salesDataKind ?? 'actual';
}

export function isProxySales(loc: LocationReport): boolean {
  const k = salesDataKind(loc);
  return k === 'proxy_benchmark' || k === 'proxy_nearest';
}

export function salesMetricColor(loc: LocationReport): string {
  const d = salesDisplayFor(loc);
  if (d?.color) return d.color;
  return isProxySales(loc) ? '#b45309' : '#2e9e5a';
}

export function salesCupsLabel(loc: LocationReport): string {
  if (isProxySales(loc)) return 'Cups · proxy';
  return 'Cups';
}
