import { kuwaitBusinessDaysInRange } from '@/features/footfall/lib/kuwaitBusinessDay';
import type { ReportPayload, ReportQuery } from './types';

/** Same-origin /api via Alert ingress → people-analytics-api (session cookies). */
const base = (import.meta.env.VITE_PEOPLE_API_BASE || '').replace(/\/$/, '');
const STORAGE_PREFIX = 'alert-footfall-report:';
const LOCAL_TTL_MS = 30 * 24 * 3600 * 1000;

/** Server builds can take several minutes on first visit. */
const MAX_POLL_ATTEMPTS = 100;
const POLL_MS_INITIAL = 2000;
const POLL_MS_LATER = 4000;
const SERVER_WAIT_SEC = 120;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function apiUrl(path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function queryString(q: ReportQuery, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  p.set('start_date', q.startDate);
  p.set('end_date', q.endDate);
  if (q.enableCompare && q.compareStartDate && q.compareEndDate) {
    p.set('compare_start_date', q.compareStartDate);
    p.set('compare_end_date', q.compareEndDate);
  }
  if (q.calendarDays) {
    p.set('calendar_days', '1');
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
    }
  }
  return p.toString();
}

function storageKey(q: ReportQuery): string {
  return `${STORAGE_PREFIX}${queryString(q)}`;
}

export function readSessionReport(q: ReportQuery): ReportPayload | undefined {
  return readLocalReport(q);
}

export function readLocalReport(q: ReportQuery): ReportPayload | undefined {
  try {
    const raw = localStorage.getItem(storageKey(q)) ?? sessionStorage.getItem(storageKey(q));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { savedAt: number; report: ReportPayload };
    if (Date.now() - parsed.savedAt > LOCAL_TTL_MS) return undefined;
    return parsed.report;
  } catch {
    return undefined;
  }
}

export function writeSessionReport(q: ReportQuery, report: ReportPayload): void {
  writeLocalReport(q, report);
}

export function writeLocalReport(q: ReportQuery, report: ReportPayload): void {
  try {
    const blob = JSON.stringify({ savedAt: Date.now(), report });
    localStorage.setItem(storageKey(q), blob);
    sessionStorage.setItem(storageKey(q), blob);
  } catch {
    /* quota */
  }
}

type CacheStatus = {
  ready: boolean;
  building: boolean;
  hasPayload: boolean;
  error?: string | null;
};

async function fetchCacheStatus(q: ReportQuery, schedule: boolean): Promise<CacheStatus> {
  const p = new URLSearchParams(queryString(q));
  p.set('schedule', schedule ? '1' : '0');
  const res = await fetch(apiUrl(`/api/commercial-footfall/cache-status?${p}`), {
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Cache status failed (${res.status})`);
  }
  return {
    ready: Boolean(json.ready),
    building: Boolean(json.building),
    hasPayload: Boolean(json.hasPayload),
    error: json.error ?? null,
  };
}

type ReportApiJson = {
  success?: boolean;
  report?: ReportPayload | null;
  building?: boolean;
  error?: string;
};

/** GET /report — returns payload when ready; may wait up to waitSec on cold start. */
async function fetchReportOnce(
  q: ReportQuery,
  opts: { refresh?: boolean; waitSec?: number } = {},
): Promise<ReportPayload | null> {
  const extra: Record<string, string> = {};
  if (opts.refresh) extra.refresh = '1';
  if (opts.waitSec && opts.waitSec > 0) extra.wait = String(Math.round(opts.waitSec));
  const url = apiUrl(`/api/commercial-footfall/report?${queryString(q, extra)}`);
  const res = await fetch(url, { credentials: 'include' });
  const json = (await res.json().catch(() => ({}))) as ReportApiJson;
  if (json.report) {
    writeLocalReport(q, json.report);
    return json.report;
  }
  if (json.building || (!res.ok && res.status === 503)) {
    return null;
  }
  if (!res.ok) {
    throw new Error(json.error || `Report failed (${res.status})`);
  }
  return null;
}

/** Background refresh only — never blocks the UI. */
function refreshInBackground(q: ReportQuery): void {
  void (async () => {
    try {
      const fresh = await fetchReportOnce(q, {});
      if (fresh) writeLocalReport(q, fresh);
    } catch {
      /* keep cached copy */
    }
  })();
}

async function pollUntilReady(
  q: ReportQuery,
  onStatus?: (message: string) => void,
): Promise<ReportPayload> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const st = await fetchCacheStatus(q, attempt < 2);
    if (st.hasPayload) {
      const report = await fetchReportOnce(q, {});
      if (report) return report;
    }
    if (!st.building && st.error) {
      throw new Error(st.error);
    }
    const elapsed = attempt * POLL_MS_LATER;
    onStatus?.(
      st.building
        ? `Server is building this week… (${Math.round(elapsed / 1000)}s — first load can take a few minutes)`
        : 'Waiting for report…',
    );
    await sleep(attempt < 5 ? POLL_MS_INITIAL : POLL_MS_LATER);
  }
  throw new Error(
    'Report build is still running on the server. Wait a minute and click Apply dates again, or try Jun 8–12 / May 10–14 presets.',
  );
}

export type TodaySalesByMachine = Record<
  string,
  {
    cups: number;
    cupsCashless: number;
    cupsWeb: number;
    revenueKd?: number;
    revenueCashlessKd?: number;
  }
>;

async function fetchSalesByMachine(
  path: string,
  params: URLSearchParams,
): Promise<TodaySalesByMachine> {
  const res = await fetch(apiUrl(`${path}?${params}`), { credentials: 'include' });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    byMachineId?: TodaySalesByMachine;
    error?: string;
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Sales fetch failed (${res.status})`);
  }
  return json.byMachineId ?? {};
}

/** Live Vendon cups for achievement · today (fast path — no full report build). */
export async function fetchTodaySales(
  salesYmd: string,
  machineIds: string[],
): Promise<TodaySalesByMachine> {
  const p = new URLSearchParams();
  p.set('date', salesYmd);
  if (machineIds.length > 0) {
    p.set('machine_ids', machineIds.join(','));
  }
  return fetchSalesByMachine('/api/commercial-footfall/today-sales', p);
}

/** Per-day Vendon sales for each business day in an inclusive range (parallel fetch, cached by caller). */
export async function fetchDailySalesRange(
  startDate: string,
  endDate: string,
  machineIds: string[],
): Promise<Record<string, TodaySalesByMachine>> {
  const days = kuwaitBusinessDaysInRange(startDate, endDate);
  if (days.length === 0) return {};
  const pairs = await Promise.all(
    days.map(async (day) => [day, await fetchTodaySales(day, machineIds)] as const),
  );
  return Object.fromEntries(pairs);
}

/** Vendon cups/revenue summed Sun→today (or any inclusive range). */
export async function fetchPeriodSales(
  startDate: string,
  endDate: string,
  machineIds: string[],
): Promise<TodaySalesByMachine> {
  const p = new URLSearchParams();
  p.set('start_date', startDate);
  p.set('end_date', endDate);
  if (machineIds.length > 0) {
    p.set('machine_ids', machineIds.join(','));
  }
  return fetchSalesByMachine('/api/commercial-footfall/period-sales', p);
}

export async function fetchReport(
  q: ReportQuery,
  refresh = false,
  onStatus?: (message: string) => void,
): Promise<ReportPayload> {
  const local = readLocalReport(q);

  if (local && !refresh) {
    refreshInBackground(q);
    return local;
  }

  onStatus?.('Loading report…');
  try {
    await fetchCacheStatus(q, true);
  } catch {
    /* schedule is best-effort */
  }

  let report = await fetchReportOnce(q, {
    refresh,
    waitSec: refresh ? 0 : SERVER_WAIT_SEC,
  });
  if (report) return report;

  if (refresh && local) {
    onStatus?.('Showing your last saved copy while the server rebuilds…');
    refreshInBackground(q);
    return local;
  }

  if (local && !refresh) {
    onStatus?.('Using saved copy while server finishes…');
    refreshInBackground(q);
    return local;
  }

  report = await pollUntilReady(q, onStatus);
  return report;
}

/** Clear browser storage only; server/DB cache is kept for fast reload. */
export function clearPageCache(q?: ReportQuery): void {
  if (q) {
    const key = storageKey(q);
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    return;
  }
  const drop = (store: Storage) => {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => store.removeItem(k));
  };
  drop(localStorage);
  drop(sessionStorage);
}

/** Clear local copy and load from server DB (does not purge server cache). */
export async function reloadFromServer(
  q: ReportQuery,
  onStatus?: (message: string) => void,
): Promise<ReportPayload> {
  clearPageCache(q);
  onStatus?.('Loading from server…');
  const report = await fetchReport(q, false, onStatus);
  writeLocalReport(q, report);
  return report;
}

/** Schedule server rebuild; keeps last payload visible when possible. */
export async function reloadAllCaches(
  q: ReportQuery,
  onStatus?: (message: string) => void,
): Promise<ReportPayload> {
  return refreshReportCache(q, onStatus);
}

export async function refreshReportCache(
  q: ReportQuery,
  onStatus?: (message: string) => void,
): Promise<ReportPayload> {
  clearPageCache(q);
  onStatus?.('Scheduling rebuild (previous data stays visible if available)…');
  const report = await fetchReport(q, true, onStatus);
  writeLocalReport(q, report);
  return report;
}

export function csvExportUrl(q: ReportQuery, machineId?: string): string {
  const p = new URLSearchParams(queryString(q));
  if (machineId) p.set('machine_id', machineId);
  return apiUrl(`/api/commercial-footfall/export.csv?${p}`);
}

export const PRESETS = {
  primaryJun2025: { startDate: '2025-06-08', endDate: '2025-06-12', label: 'Jun 8–12, 2025 (Sun–Thu)' },
  primaryJun15_2025: { startDate: '2025-06-15', endDate: '2025-06-19', label: 'Jun 15–19, 2025 (Sun–Thu)' },
  fallbackMay2026: { startDate: '2026-05-10', endDate: '2026-05-14', label: 'May 10–14, 2026 (new machines)' },
  compareSample: { startDate: '2025-05-04', endDate: '2025-05-08', label: 'Prior week (compare)' },
  /** Week before Jun 15–19 for period compare */
  compareJun8_2025: { startDate: '2025-06-08', endDate: '2025-06-12', label: 'Jun 8–12, 2025 (compare)' },
} as const;

export function prefetchDefaultCache(): void {
  fetchCacheStatus({ ...PRESETS.fallbackMay2026, enableCompare: false }, true).catch(() => {});
}
