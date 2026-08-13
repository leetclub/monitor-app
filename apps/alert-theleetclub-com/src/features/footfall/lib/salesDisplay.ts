import type { LocationReport, SalesDisplayMeta } from '@/features/footfall/lib/types';
import { ffMetricColors } from '@/features/footfall/lib/ffMetricColors';

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
  const c = ffMetricColors();
  if (d?.color) {
    if (d.color === '#b45309') return c.proxy;
    if (d.color === '#2e9e5a' || d.color === '#15803d') return c.actual;
    return d.color;
  }
  return isProxySales(loc) ? c.proxy : c.actual;
}

export function salesCupsLabel(loc: LocationReport): string {
  if (isProxySales(loc)) return 'Cups · proxy';
  return 'Cups';
}
