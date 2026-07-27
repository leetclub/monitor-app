import { normKeysForQaMachine, normKey, qaMachineNamesMatch } from '@/lib/qaMachineAliases';

export type QaVisitRow = {
  location?: string | null;
  role?: string | null;
  officerName?: string | null;
  officerId?: string | null;
  lastVisitAt?: string | null;
  lastVisitDate?: string | null;
  daysSinceVisit?: number | null;
  isQc?: boolean;
  auditId?: string | null;
  score?: number | null;
  reportUrl?: string | null;
  summary?: string | null;
  visitCountMtd?: number | null;
  /** Admin manual summary saves this Kuwait calendar month (separate from SC visitCountMtd). */
  adminSummaryMtd?: number | null;
  adminSummary?: boolean | null;
  adminSummaryAt?: string | null;
  adminSummaryBy?: string | null;
  keyFindings?: string[] | null;
};

export type QaFindingRow = {
  location?: string;
  qaFinding?: string;
  resolved?: string;
  amVerified?: string;
  operator?: string;
  response?: string;
};

export type QaSummaryResponse = {
  count?: number;
  countTech?: number;
  byLocationKey?: Record<string, QaVisitRow>;
  byLocationKeyTech?: Record<string, QaVisitRow>;
  visits?: QaVisitRow[];
  visitsTech?: QaVisitRow[];
  totalVisits?: number;
  auditsSearched?: number;
  locationsWithQc?: number;
  locationsWithTech?: number;
  source?: string;
  error?: string;
  warning?: string;
  partial?: boolean;
  auditsProcessed?: number;
  /** Admin manual summary saves per normalized machine key — Kuwait calendar month. */
  adminSummaryMtdByMachine?: Record<string, number>;
  yearMonth?: string;
  /** Newest QC visit per Vendon machine (chunked SC scan; preferred for fleet cells). */
  latestByMachine?: Record<string, QaVisitRow>;
  latestByMachineDateFrom?: string | null;
  latestByMachineDateTo?: string | null;
};

export type QaFindingsResponse = {
  findings?: QaFindingRow[];
  total?: number;
  error?: string;
  source?: string;
};


function latestVisitForMachine(
  machineName: string,
  latestByMachine?: Record<string, QaVisitRow> | null,
): QaVisitRow | undefined {
  if (!latestByMachine) return undefined;
  const direct = latestByMachine[machineName];
  if (direct?.auditId || direct?.lastVisitAt || direct?.lastVisitDate) return direct;
  for (const [key, row] of Object.entries(latestByMachine)) {
    if (!row) continue;
    if (!(row.auditId || row.lastVisitAt || row.lastVisitDate)) continue;
    if (qaMachineNamesMatch(key, machineName)) return row;
  }
  return undefined;
}

export function qaVisitForMachineName(
  machineName: string,
  byLocationKey: Record<string, QaVisitRow> | undefined,
  adminMtdByMachine?: Record<string, number> | null,
  latestByMachine?: Record<string, QaVisitRow> | null,
): QaVisitRow | null {
  const fromLatest = latestVisitForMachine(machineName, latestByMachine);
  const visit =
    fromLatest?.auditId || fromLatest?.lastVisitAt || fromLatest?.lastVisitDate
      ? fromLatest
      : visitForMachineName(machineName, byLocationKey);
  const scMtd = visit?.visitCountMtd ?? 0;
  const adminMtd =
    adminMtdByMachine != null
      ? adminSummaryMtdForMachine(machineName, adminMtdByMachine)
      : (visit?.adminSummaryMtd ?? 0);
  if (!visit && scMtd <= 0 && adminMtd <= 0) return null;
  return { ...(visit ?? {}), visitCountMtd: scMtd, adminSummaryMtd: adminMtd };
}

export function techVisitForMachineName(
  machineName: string,
  byLocationKey: Record<string, QaVisitRow> | undefined,
): QaVisitRow | null {
  return visitForMachineName(machineName, byLocationKey);
}

function visitForMachineName(
  machineName: string,
  byLocationKey: Record<string, QaVisitRow> | undefined,
): QaVisitRow | null {
  const needle = normKey(machineName);
  if (!needle || !byLocationKey) return null;

  const aliasKeys = normKeysForQaMachine(machineName);
  const candidates: Array<{ priority: number; at: string; row: QaVisitRow }> = [];

  const consider = (row: QaVisitRow | undefined, priority: number) => {
    if (!row) return;
    const lat = String(row.lastVisitAt || row.lastVisitDate || '');
    if (!lat && row.auditId == null && (row.daysSinceVisit == null || !Number.isFinite(row.daysSinceVisit))) {
      return;
    }
    // Prefer rows with a timestamp; auditId alone is enough for ranking key.
    const at = lat || String(row.auditId || '');
    if (!at && row.daysSinceVisit == null) return;
    candidates.push({ priority, at: at || `d${row.daysSinceVisit}`, row });
  };

  consider(byLocationKey[needle], 100);
  for (const ak of aliasKeys) {
    consider(byLocationKey[ak], 90);
  }
  for (const [nk, row] of Object.entries(byLocationKey)) {
    const loc = String(row.location || nk);
    const locKey = normKey(loc);
    if (aliasKeys.has(nk) || aliasKeys.has(locKey) || qaMachineNamesMatch(machineName, loc)) {
      consider(row, 50);
      continue;
    }
    // Soft fallback (backend parity): distinctive substring overlap when names share a site token.
    if (needle.length >= 4 && (needle.includes(nk) || nk.includes(needle) || locKey.includes(needle) || needle.includes(locKey))) {
      const shorter = Math.min(needle.length, Math.max(nk.length, locKey.length));
      if (shorter >= 4) consider(row, 35);
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const byDate = b.at.localeCompare(a.at);
    if (byDate !== 0) return byDate;
    return b.priority - a.priority;
  });
  return candidates[0]!.row;
}

/** Milliseconds since epoch for column sort (most recent = largest). */
export function qaLastVisitSortMs(visit: QaVisitRow | null | undefined): number | null {
  if (!visit) return null;
  const raw = visit.lastVisitAt || visit.lastVisitDate;
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? null : t;
}

/** Admin manual summaries saved this Kuwait calendar month (fleet summary map). */
export function adminSummaryMtdForMachine(
  machineName: string,
  counts: Record<string, number> | undefined | null,
): number {
  if (!counts) return 0;
  const keys = normKeysForQaMachine(machineName);
  let total = 0;
  for (const k of keys) {
    total += Number(counts[k]) || 0;
  }
  if (total > 0) return total;

  const needle = normKey(machineName);
  if (!needle) return 0;
  if (counts[needle] != null) return Number(counts[needle]) || 0;
  let best = 0;
  let bestLen = 0;
  for (const [mk, cnt] of Object.entries(counts)) {
    if (needle.includes(mk) || mk.includes(needle)) {
      const ln = Math.min(needle.length, mk.length);
      if (ln > bestLen) {
        bestLen = ln;
        best = Number(cnt) || 0;
      }
    }
  }
  return best;
}

export function qaFindingsForMachineName(
  machineName: string,
  findings: QaFindingRow[] | undefined,
  openOnly = true,
): QaFindingRow[] {
  const needle = normKey(machineName);
  if (!needle || !findings?.length) return [];
  return findings.filter((row) => {
    const loc = normKey(row.location || '');
    if (!loc || (!needle.includes(loc) && !loc.includes(needle))) return false;
    if (!openOnly) return true;
    const resolved = (row.resolved || '').toLowerCase();
    return !['done', 'resolved', 'closed', 'complete', 'completed'].includes(resolved);
  });
}

export type QaScoreTone = 'good' | 'mid' | 'low' | 'muted';

/** Score chip for QA visit card — color by percentage band. */
export function qaScoreDisplay(score: number | null | undefined): {
  text: string;
  tone: QaScoreTone;
} {
  if (score == null || !Number.isFinite(Number(score))) {
    return { text: '—', tone: 'muted' };
  }
  const n = Math.round(Number(score));
  const text = `${n}%`;
  if (n >= 85) return { text, tone: 'good' };
  if (n >= 70) return { text, tone: 'mid' };
  return { text, tone: 'low' };
}
