export type TargetMachineDetail = {
  machineId?: string;
  machineName?: string;
  locationOwner?: string | null;
  segment?: string;
  dailyTargetKd?: number | null;
  weekTargetKd?: number | null;
  todayKwd?: number;
  yesterdayKwd?: number;
  todayPct?: number | null;
  yesterdayPct?: number | null;
  remainingPct?: number | null;
  wtdActualKd?: number;
  wtdTargetKd?: number | null;
  wtdPct?: number | null;
  priorWtdActualKd?: number;
  priorWtdPct?: number | null;
  wtdTrendPct?: number | null;
  wtdThroughDate?: string;
  ownerContact?: {
    email?: string | null;
    phone?: string | null;
    whatsappUrl?: string | null;
    slackDmUrl?: string | null;
    slackUserId?: string | null;
  };
  error?: string;
};

/** First given name for compact table cells — never abbreviated with ellipsis. */
export function ownerCardFirstName(fullName: string | null | undefined): string | null {
  const t = String(fullName ?? '').trim();
  if (!t) return null;
  const parts = t.split(/\s+/).filter(Boolean);
  return parts[0] ?? t;
}

export function resolveLocationOwnerName(
  areaOwnerPerson: string | null | undefined,
  adminOrVendonOwner?: string | null,
  amFallback?: string | null,
): string | null {
  /** Admin → Area owners person assignment wins over location tag (KU/MOH). */
  const area = String(areaOwnerPerson ?? '').trim();
  if (area) return area;
  const tag = String(adminOrVendonOwner ?? '').trim();
  if (tag) return tag;
  const am = String(amFallback ?? '').trim();
  return am || null;
}

export function formatTargetPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${Math.round(pct)}%`;
}

export function targetStackValues(
  todayKwd: number | undefined,
  yesterdayKwd: number | undefined,
  dailyTargetKd: number | null | undefined,
): {
  todayPct: number | null;
  remainingPct: number | null;
  yesterdayPct: number | null;
} {
  const target = typeof dailyTargetKd === 'number' && dailyTargetKd > 0 ? dailyTargetKd : null;
  if (!target) {
    return { todayPct: null, remainingPct: null, yesterdayPct: null };
  }
  const today = typeof todayKwd === 'number' && Number.isFinite(todayKwd) ? todayKwd : 0;
  const yest = typeof yesterdayKwd === 'number' && Number.isFinite(yesterdayKwd) ? yesterdayKwd : null;
  const todayPct = Math.round((today / target) * 10000) / 100;
  const remainingPct = Math.round(Math.max(0, target - today) / target * 10000) / 100;
  const yesterdayPct =
    yest != null ? Math.round((yest / target) * 10000) / 100 : null;
  return { todayPct, remainingPct, yesterdayPct };
}
