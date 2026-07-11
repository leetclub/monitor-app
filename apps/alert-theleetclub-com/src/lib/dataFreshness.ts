/** User-facing copy for server / React Query cache tiers. */

export type DataFreshnessTier = 'minute' | 'schedule' | 'snapshot';

const TIER_HINT: Record<DataFreshnessTier, string> = {
  minute: 'refreshes ~1 min',
  schedule: 'schedule cache ~3 min',
  snapshot: 'snapshot cache',
};

export function parseIsoMs(iso: string | null | undefined): number | null {
  const t = String(iso ?? '').trim();
  if (!t) return null;
  const ms = Date.parse(t.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

export function formatAgeShort(iso: string | null | undefined): string | null {
  const ms = parseIsoMs(iso);
  if (ms == null) return null;
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 45) return 'just now';
  if (sec < 90) return '~1m ago';
  if (sec < 3600) return `~${Math.round(sec / 60)}m ago`;
  return `~${Math.floor(sec / 3600)}h ago`;
}

export function freshnessNotice(
  tier: DataFreshnessTier,
  updatedAt?: string | null,
  opts?: { fetching?: boolean; stale?: boolean },
): string {
  const age = formatAgeShort(updatedAt);
  const base = age ? `updated ${age}` : 'cached';
  const hint = TIER_HINT[tier];
  if (opts?.fetching) return `${base} · updating…`;
  if (opts?.stale) return `${base} · refresh pending`;
  return `${base} · ${hint}`;
}

/** True when server marked payload stale or cache age exceeds sales refresh tier. */
export function isDailySalesStale(
  data: { stale?: boolean; cacheGeneratedAt?: string | null } | undefined,
): boolean {
  if (!data) return true;
  if (data.stale) return true;
  const ms = parseIsoMs(data.cacheGeneratedAt);
  if (ms == null) return false;
  const sec = (Date.now() - ms) / 1000;
  return sec > 90;
}

export function fleetSalesMachineIds(
  response: { allowedMachineIds?: string[] } | undefined,
  fallback: Iterable<string>,
): string[] {
  const fromApi = response?.allowedMachineIds;
  if (fromApi?.length) return fromApi.map((id) => String(id).trim()).filter(Boolean);
  return [...fallback].map((id) => String(id).trim()).filter(Boolean);
}
