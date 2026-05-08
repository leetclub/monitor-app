import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ComparePresetPicker, type CompareSelection } from '@/components/ComparePresetPicker';
import {
  initialCompareSelection,
  persistCompareSelection,
} from '@/lib/comparePresetBridge';
import { apiGet } from '@/lib/api';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { safeText } from '@/lib/safeText';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import {
  OVERALL_COLUMNS,
  OVERALL_HEADER_SHORT,
  OVERALL_XLSX_ORDER,
  type OverallColumnKey,
} from './overallWorkbookColumns';
import styles from './OverallPage.module.css';

type Machine = { id: string; name: string; vendon_location_owner?: string | null };
type MachinesResponse = { machines: Machine[] };

type Snapshot = {
  generatedAt?: string;
  cacheGeneratedAt?: string | null;
  rows?: RedAlertRow[];
};

type AdminProfileRow = {
  machine_id: string;
  location_owner?: string | null;
  location_hours?: string | null;
  operator_name?: string | null;
  timezone?: string | null;
  operating_days?: unknown;
  cleaning_windows?: unknown;
  operator_hours?: unknown;
  technician_schedule?: unknown;
  qa_schedule?: unknown;
  priority?: number | null;
  updated_at?: string | null;
};

type AdminProfilesResponse = { rows: AdminProfileRow[] };

type VendonSalesSummaryResponse = {
  preset: string;
  dateA: string;
  dateB: string;
  byMachineId: Record<
    string,
    {
      aSalesKwd: number | null;
      bSalesKwd: number | null;
      trendPct: number | null;
      peakHour?: { hour: number; count: number; label: string } | null;
      topProduct?: { name: string; count: number } | null;
      lowProduct?: { name: string; count: number } | null;
    }
  >;
};

type VendonLastTransactionsResponse = {
  byMachineId: Record<
    string,
    {
      timestamp: number;
      product_name?: string | null;
      amount?: number | string | null;
    }
  >;
  fromTimestamp?: number;
  toTimestamp?: number;
  error?: string;
};

type LiveDashboardMachine = {
  machineId: string;
  salesToday?: number | null;
  salesYesterday?: number | null;
  dailyTarget?: number | null;
  lastCleaningAt?: string | null;
  shift?: {
    expectedStart?: string | null;
    timezone?: string | null;
    graceMinutes?: number | null;
    clockInAt?: number | null; // unix seconds
    late?: boolean | null;
  } | null;
};

type LiveDashboardSnapshotResponse = {
  machines?: LiveDashboardMachine[];
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function snapshotMostIssue(snap: RedAlertRow | undefined): string {
  const reasons = snap?.reasons;
  if (!reasons?.length) return '';
  const t = String(reasons[reasons.length - 1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

/** Compact dispense-fail counts when we do not have a single “last fail” timestamp in the snapshot row. */
function headerTooltip(key: OverallColumnKey): string {
  const c = OVERALL_COLUMNS[key];
  if (c.note) return `${c.title} — ${c.note}`;
  return c.title;
}

function snapshotVendFailSummary(snap: RedAlertRow | undefined): string {
  const fq = snap?.frequency;
  if (!fq) return '';
  const td = fq.dispenseFailsToday;
  const wtd = fq.dispenseFailsThisWeek;
  const parts: string[] = [];
  if (td != null && Number(td) > 0) parts.push(`${td} today`);
  if (wtd != null && Number(wtd) > 0) parts.push(`${wtd} WTD`);
  return parts.join(' · ');
}

function formatPct(pct: number): string {
  const p = Math.round(pct);
  if (!Number.isFinite(p)) return '—';
  const sign = p > 0 ? '+' : '';
  return `${sign}${p}%`;
}

function formatKwd(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `${x.toFixed(2)} KWD`;
}

function fmtTimeRange(start: string, end: string): string {
  const s = String(start || '').trim();
  const e = String(end || '').trim();
  if (!s && !e) return '';
  if (s && e) return `${s}–${e}`;
  return s || e;
}

function operatingDaysLabel(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const o = raw as Record<string, unknown>;
  const preset = String(o.preset || '').trim();
  if (preset === 'all_week') return 'All week';
  if (preset === 'weekends_off') return 'Weekends off';
  if (preset === 'custom' && Array.isArray(o.days)) {
    const days = (o.days as unknown[])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)
      .map((n) => DAY_LABELS[n] ?? String(n));
    return days.length ? `Days: ${days.join(', ')}` : 'Days: custom';
  }
  return '';
}

function operatorHoursSummary(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const first = raw[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return '';
  const o = first as Record<string, unknown>;
  const name = String(o.name || '').trim();
  const wins = Array.isArray(o.windows) ? (o.windows as unknown[]) : [];
  const parts: string[] = [];
  for (const w of wins) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    const ww = w as Record<string, unknown>;
    const seg = fmtTimeRange(String(ww.start || ''), String(ww.end || ''));
    if (seg) parts.push(seg);
  }
  const t = parts.join(', ');
  if (name && t) return `${name}: ${t}`;
  if (name) return name;
  return t;
}

function parseTimeToMinutes(hhmm: string): number | null {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function cleaningWindowsFromAdmin(raw: unknown): { startMin: number; endMin: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { startMin: number; endMin: number }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const s = parseTimeToMinutes(String(o.start ?? ''));
    const e = parseTimeToMinutes(String(o.end ?? ''));
    if (s == null || e == null) continue;
    out.push({ startMin: s, endMin: e });
  }
  return out;
}

function kuwaitDateKey(iso: string): string {
  // `formatKuwaitDateTime` is display-only; for comparisons we use an Intl formatter.
  const dt = new Date(iso);
  // If invalid, just return empty.
  if (!Number.isFinite(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
}

function kuwaitMinutesOfDay(iso: string): number | null {
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuwait',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dt);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function lastCleanedStatus(params: {
  lastCleaningIso: string;
  cleaningWindows: { startMin: number; endMin: number }[];
}): { label: string; color: 'g' | 'y' | 'r' } {
  const { lastCleaningIso, cleaningWindows } = params;
  const day = kuwaitDateKey(lastCleaningIso);
  const today = kuwaitDateKey(new Date().toISOString());
  if (!day || day !== today) return { label: 'No cleaning', color: 'r' };
  const t = kuwaitMinutesOfDay(lastCleaningIso);
  if (t == null) return { label: 'Cleaned', color: 'y' };
  if (!cleaningWindows.length) return { label: 'Cleaned', color: 'y' };
  const inside = cleaningWindows.some((w) => t >= w.startMin && t <= w.endMin);
  return inside ? { label: 'On schedule', color: 'g' } : { label: 'Outside schedule', color: 'y' };
}

function comparePct(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b <= 0) return null;
  return ((a - b) / b) * 100;
}

function attendanceLabelFromShift(
  m: LiveDashboardMachine | undefined,
): { label: string; color: 'g' | 'y' | 'o' | 'r' } | null {
  const shift = m?.shift;
  if (!shift) return null;
  const exp = String(shift.expectedStart || '').trim();
  if (!exp) return null;
  const clockInAt = shift.clockInAt != null ? Number(shift.clockInAt) : null;
  if (!clockInAt || !Number.isFinite(clockInAt) || clockInAt <= 0) {
    return { label: 'Absent', color: 'r' };
  }
  const d = new Date(clockInAt * 1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const clockMin = hh * 60 + mm;
  const mExp = exp.match(/^(\d{1,2}):(\d{2})$/);
  if (!mExp) return null;
  const expMin = Number(mExp[1]) * 60 + Number(mExp[2]);
  const delta = clockMin - expMin;
  if (delta < 10) return { label: 'On Time', color: 'g' };
  if (delta <= 20) return { label: 'Late', color: 'y' };
  if (delta <= 60) return { label: 'Tardy', color: 'o' };
  return { label: 'Absent', color: 'r' };
}

export function OverallPage() {
  const [compare, setCompare] = useState<CompareSelection>(() => initialCompareSelection());
  const setComparePersist = useCallback((next: CompareSelection) => {
    setCompare(next);
    persistCompareSelection(next);
  }, []);

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    refetchInterval: 60_000,
  });

  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    refetchInterval: 60_000,
  });

  const profilesQ = useQuery({
    queryKey: ['alert-overall-admin-profiles'],
    queryFn: () => apiGet<AdminProfilesResponse>('/api/alert/overall/admin-profiles'),
    refetchInterval: 60_000,
  });

  const vendonSummaryQ = useQuery({
    queryKey: ['alert-overall-vendon-sales-summary', compare.preset],
    queryFn: () =>
      apiGet<VendonSalesSummaryResponse>(`/api/alert/overall/vendon-sales-summary?preset=${encodeURIComponent(compare.preset)}`),
    refetchInterval: 5 * 60_000,
  });

  const vendonLastTxQ = useQuery({
    queryKey: ['alert-overall-vendon-last-transactions'],
    queryFn: () => apiGet<VendonLastTransactionsResponse>('/api/alert/overall/last-transactions'),
    refetchInterval: 2 * 60_000,
  });

  const liveSnapQ = useQuery({
    queryKey: ['live-dashboard-snapshot'],
    queryFn: () => apiGet<LiveDashboardSnapshotResponse>('/api/live-dashboard/snapshot'),
    refetchInterval: 60_000,
  });

  const machines = useMemo(() => {
    const raw = machinesQ.data?.machines;
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => ({
      id: safeText(m?.id),
      name: safeText(m?.name) || safeText(m?.id),
      vendon_location_owner:
        m?.vendon_location_owner != null && String(m.vendon_location_owner).trim()
          ? safeText(m.vendon_location_owner)
          : null,
    }));
  }, [machinesQ.data]);

  /**
   * Overall historically listed **all** machines from Vendon (`/api/alert/machines`). That call can return []
   * when Vendon is misconfigured or errors — while Red Flags still has rows from the snapshot cache.
   * Fall back to machine ids/names from the snapshot so the tab is not empty when Red Flags works.
   */
  const fleetMachines = useMemo((): {
    id: string;
    name: string;
    vendon_location_owner: string | null;
  }[] => {
    if (machines.length > 0) return machines;
    const rows = snapQ.data?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const seen = new Set<string>();
    const out: { id: string; name: string; vendon_location_owner: string | null }[] = [];
    for (const r of rows) {
      const id = String(r.machineId ?? r.machine_id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        name: safeText(r.machineName) || id,
        vendon_location_owner: null,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [machines, snapQ.data?.rows]);

  const fleetFromSnapshotFallback = fleetMachines.length > 0 && machines.length === 0;

  const loadingFleetTable =
    fleetMachines.length === 0 && (machinesQ.isLoading || (machines.length === 0 && snapQ.isLoading));

  const profileByMachineId = useMemo(() => {
    const m = new Map<string, AdminProfileRow>();
    const rows = profilesQ.data?.rows;
    if (!Array.isArray(rows)) return m;
    for (const r of rows) {
      const id = String(r.machine_id ?? '').trim();
      if (id) m.set(id, r);
    }
    return m;
  }, [profilesQ.data]);

  const snapshotByMachineId = useMemo(() => {
    const m = new Map<string, RedAlertRow>();
    const rows = snapQ.data?.rows;
    if (!Array.isArray(rows)) return m;
    for (const r of rows) {
      const id = String(r.machineId ?? r.machine_id ?? '').trim();
      if (id) m.set(id, r);
    }
    return m;
  }, [snapQ.data]);

  const liveByMachineId = useMemo(() => {
    const m = new Map<string, LiveDashboardMachine>();
    const rows = liveSnapQ.data?.machines;
    if (!Array.isArray(rows)) return m;
    for (const r of rows) {
      const id = String(r.machineId ?? '').trim();
      if (id) m.set(id, r);
    }
    return m;
  }, [liveSnapQ.data]);

  const snapshotMachineCount = snapshotByMachineId.size;

  const presetLabels = useMemo(
    () =>
      ({
        today_vs_yesterday: 'Today VS Yesterday (default view)',
        today_vs_same_day_last_week: 'Today VS Same Day Last Week',
        wtd_vs_last_week: 'WTD VS Last Week',
        mtd_vs_mtd: 'Month to date VS Month to date',
        custom_vs_custom: 'Custom period VS Custom period',
      }) as const,
    [],
  );

  return (
    <div className="pageShell">
      <header className="pageHero">
        <div className="pageHeroMain">
          <h1 className="pageTitle">Overall</h1>
          <p className="pageSubtitle">
            Fleet overview: <strong>Operating hours</strong> come from Alert Admin (machine profile → Location hours). Metrics
            such as last transaction, cleaning, reasons, and vend-fail counts come from the <strong>Red Alert snapshot</strong>{' '}
            when that machine is on Red Flags. Other columns stay empty until those APIs are wired.
          </p>
        </div>
        <div className="pageHeroAside">
          <p className="pageMeta">Auto refresh ~1 min</p>
          <button
            type="button"
            className="btnSolid"
            onClick={() => {
              void Promise.all([
                machinesQ.refetch(),
                snapQ.refetch(),
                profilesQ.refetch(),
                vendonSummaryQ.refetch(),
                vendonLastTxQ.refetch(),
                liveSnapQ.refetch(),
              ]);
            }}
            disabled={
              machinesQ.isFetching ||
              snapQ.isFetching ||
              profilesQ.isFetching ||
              vendonSummaryQ.isFetching ||
              vendonLastTxQ.isFetching ||
              liveSnapQ.isFetching
            }
          >
            {machinesQ.isFetching ||
            snapQ.isFetching ||
            profilesQ.isFetching ||
            vendonSummaryQ.isFetching ||
            vendonLastTxQ.isFetching ||
            liveSnapQ.isFetching
              ? 'Refreshing…'
              : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="surfaceCard surfaceCardSpaced">
        <div className="surfaceSectionLabel">Timespan comparison</div>
        <ComparePresetPicker value={compare} onChange={setComparePersist} />
        <p className="surfaceHint">
          Selected: <strong>{presetLabels[compare.preset]}</strong>. Period A/B apply when comparison metrics are available.
        </p>
      </section>

      {machinesQ.isError ? (
        <section className="surfaceCard surfaceCardSpaced surfaceCardWarn">
          <p className="surfaceHint" style={{ margin: 0 }}>
            {(machinesQ.error as Error).message}
            {fleetFromSnapshotFallback
              ? ' — Rows below use the Red Alert snapshot so you still see machines that appear on Red Flags.'
              : ''}
          </p>
        </section>
      ) : null}

      {fleetFromSnapshotFallback ? (
        <section className="surfaceCard surfaceCardSpaced">
          <p className="surfaceHint" style={{ margin: 0 }}>
            Fleet list is built from the <strong>Red Alert snapshot</strong> because the live Vendon machine list was empty
            or unavailable. Tags may be missing until{' '}
            <code style={{ fontSize: '0.88em' }}>GET /api/alert/machines</code> returns data.
          </p>
        </section>
      ) : null}

      {snapQ.isError ? (
        <section className="surfaceCard surfaceCardSpaced surfaceCardWarn">
          <p className="surfaceHint" style={{ margin: 0 }}>
            Red Alert snapshot could not be loaded: {(snapQ.error as Error).message}. Last transaction / operator merge may
            be incomplete.
          </p>
        </section>
      ) : null}

      {fleetMachines.length > 0 && snapshotMachineCount < fleetMachines.length ? (
        <section className="surfaceCard surfaceCardSpaced">
          <p className="surfaceHint" style={{ margin: 0 }}>
            Snapshot-backed columns fill only for machines in the current Red Flags list ({snapshotMachineCount} of{' '}
            {fleetMachines.length} rows here). Machines that are not flagged still show name/tag and Admin profile fields.
          </p>
        </section>
      ) : null}

      <section className="surfaceCard">
        <div className={styles.fleetToolbar}>
          <span className="surfaceBadge">{fleetMachines.length} machines</span>
        </div>

        <div className={`tableWrap tableWrapLoose ${styles.fleetWrap}`}>
          <table>
            <thead>
              <tr>
                {OVERALL_XLSX_ORDER.map((key) => (
                  <th key={key} title={headerTooltip(key)}>
                    {OVERALL_HEADER_SHORT[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingFleetTable ? (
                <tr>
                  <td colSpan={20} className="muted">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {fleetMachines.map((m) => {
                const snap = snapshotByMachineId.get(m.id);
                const live = liveByMachineId.get(m.id);
                const mins = snap?.minutesSinceLastTransaction ?? snap?.minutes_since_last_transaction;
                const minsOk = mins != null && typeof mins === 'number' && !Number.isNaN(mins);
                const prof = profileByMachineId.get(m.id);
                const vendon = vendonSummaryQ.data?.byMachineId?.[m.id];
                const locHours = String(prof?.location_hours ?? '').trim();
                const locationOwner = String(m.vendon_location_owner ?? prof?.location_owner ?? '').trim();
                const operating = locHours ? `${locHours} hrs` : '—';
                const lastCleanedIso = snap?.lastCleaningAt != null ? String(snap.lastCleaningAt).trim() : '';
                const vendFailSummary = snapshotVendFailSummary(snap);
                const mostIssue = snapshotMostIssue(snap);
                const machTag = locationOwner;
                const operator =
                  String(prof?.operator_name ?? '').trim() ||
                  String(snap?.operator ?? snap?.operatorName ?? snap?.redAlertOperator ?? '').trim() ||
                  '—';
                const txRaw =
                  snap?.lastTransactionAtUtc ??
                  snap?.last_transaction_at_utc ??
                  snap?.lastSaleAtUtc ??
                  snap?.last_sale_at_utc ??
                  snap?.lastTransactionAt ??
                  snap?.last_transaction_at ??
                  null;
                const vendonTx = vendonLastTxQ.data?.byMachineId?.[m.id];
                const vendonTxIso =
                  vendonTx?.timestamp != null && Number(vendonTx.timestamp) > 0
                    ? new Date(Number(vendonTx.timestamp) * 1000).toISOString()
                    : '';
                const peakHourLabel = vendon?.peakHour?.label || '';
                const topProduct = vendon?.topProduct?.name || '';
                const lowProduct = vendon?.lowProduct?.name || '';
                const trendPct = vendon?.trendPct;
                const aSales = vendon?.aSalesKwd;
                const bSales = vendon?.bSalesKwd;
                const liveSalesTrend = comparePct(Number(live?.salesToday ?? NaN), Number(live?.salesYesterday ?? NaN));
                const liveTargetPct =
                  live?.dailyTarget != null && Number(live.dailyTarget) > 0
                    ? (Number(live?.salesToday ?? 0) / Number(live.dailyTarget)) * 100
                    : null;
                const att = attendanceLabelFromShift(live);
                const cleanIso = lastCleanedIso || String(live?.lastCleaningAt ?? '').trim();
                const cleanWins = cleaningWindowsFromAdmin(prof?.cleaning_windows);
                const cleanStatus = cleanIso ? lastCleanedStatus({ lastCleaningIso: cleanIso, cleaningWindows: cleanWins }) : null;
                const adminMetaHintParts: string[] = [];
                if (prof?.timezone) adminMetaHintParts.push(`TZ: ${String(prof.timezone)}`);
                if (prof?.priority != null) adminMetaHintParts.push(`Priority: ${String(prof.priority)}`);
                if (prof?.operating_days != null) adminMetaHintParts.push(`Operating days configured`);
                if (prof?.cleaning_windows != null) adminMetaHintParts.push(`Cleaning windows configured`);
                const daysLabel = operatingDaysLabel(prof?.operating_days);
                const opHours = operatorHoursSummary(prof?.operator_hours);
                return (
                  <tr key={m.id}>
                    <td
                      title={
                        locHours
                          ? `Alert Admin → machine profile → Location hours${adminMetaHintParts.length ? ` · ${adminMetaHintParts.join(' · ')}` : ''}`
                          : `Set Location hours in Alert Admin${adminMetaHintParts.length ? ` · ${adminMetaHintParts.join(' · ')}` : ''}`
                      }
                    >
                      {operating}
                      {daysLabel ? (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          {daysLabel}
                        </div>
                      ) : null}
                      {locationOwner ? (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          Location Owner: {locationOwner}
                        </div>
                      ) : null}
                      {prof?.timezone ? (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          TZ: {String(prof.timezone)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {m.name}
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        #{m.id}
                      </div>
                      {machTag ? (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          Location Owner: {machTag}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {operator}
                      {opHours ? (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          {opHours}
                        </div>
                      ) : null}
                    </td>
                    <td title={OVERALL_COLUMNS.attendance.note}>
                      {att ? (
                        <span
                          className={
                            att.color === 'g'
                              ? 'pillSuccess'
                              : att.color === 'y'
                                ? 'pillWarn'
                                : att.color === 'o'
                                  ? 'pillWarn'
                                  : 'pillDanger'
                          }
                          style={{ fontSize: '0.78rem' }}
                        >
                          {att.label}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td title={OVERALL_COLUMNS.lastCleaned.note}>
                      {cleanIso ? (
                        <>
                          <div>{formatKuwaitDateTime(cleanIso)}</div>
                          {cleanStatus ? (
                            <div style={{ marginTop: 4 }}>
                              <span
                                className={
                                  cleanStatus.color === 'g'
                                    ? 'pillSuccess'
                                    : cleanStatus.color === 'y'
                                      ? 'pillWarn'
                                      : 'pillDanger'
                                }
                                style={{ fontSize: '0.78rem' }}
                              >
                                {cleanStatus.label}
                              </span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td title={OVERALL_COLUMNS.lastVendFailed.note}>
                      {vendFailSummary ? vendFailSummary : <span className="muted">—</span>}
                    </td>
                    <td
                      title={
                        txRaw
                          ? 'Red Alert snapshot'
                          : minsOk
                            ? 'Minutes since last sale (snapshot)'
                            : vendonTxIso
                              ? 'Vendon last transaction (24h window)'
                              : undefined
                      }
                    >
                      {txRaw ? (
                        formatKuwaitDateTime(String(txRaw))
                      ) : minsOk ? (
                        `${String(mins)} min since sale`
                      ) : vendonTxIso ? (
                        formatKuwaitDateTime(vendonTxIso)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      title={
                        aSales != null && bSales != null
                          ? `Sales A: ${formatKwd(aSales)} · Sales B: ${formatKwd(bSales)}`
                          : 'Sales trend uses Vendon cached daily sales for the selected preset (Kuwait day).'
                      }
                    >
                      {typeof trendPct === 'number' && Number.isFinite(trendPct) ? (
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPct(trendPct)}</span>
                      ) : typeof liveSalesTrend === 'number' && Number.isFinite(liveSalesTrend) ? (
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPct(liveSalesTrend)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td title={OVERALL_COLUMNS.targetAchieved.note}>
                      {typeof liveTargetPct === 'number' && Number.isFinite(liveTargetPct) ? (
                        <span className={liveTargetPct >= 100 ? 'pillSuccess' : 'pillDanger'} style={{ fontSize: '0.78rem' }}>
                          {Math.round(liveTargetPct)}%
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td title="Peak hour uses Vendon vends (cached) bucketed by Kuwait local hour.">
                      {peakHourLabel ? <span>{peakHourLabel}</span> : <span className="muted">—</span>}
                    </td>
                    <td className="muted" title={OVERALL_COLUMNS.promotion.note}>
                      —
                    </td>
                    <td title="Highest product uses Vendon vends (cached) for the Kuwait day (by count).">
                      {topProduct ? <span className="tableCellWrap">{topProduct}</span> : <span className="muted">—</span>}
                    </td>
                    <td title="Lowest product uses Vendon vends (cached) for the Kuwait day (by count).">
                      {lowProduct ? <span className="tableCellWrap">{lowProduct}</span> : <span className="muted">—</span>}
                    </td>
                    <td className="muted" title={OVERALL_COLUMNS.peopleCount.note}>
                      —
                    </td>
                    <td className="muted" title={OVERALL_COLUMNS.customerCalls.note}>
                      —
                    </td>
                    <td title={OVERALL_COLUMNS.mostIssue.note}>
                      {mostIssue ? (
                        <span style={{ fontSize: '0.88rem' }}>{mostIssue}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.lastQaCheck.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.lastTechCheck.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.wastagePct.note}>
                        ?
                      </span>
                    </td>
                    <td className="muted">
                      <span className="fleetCellMissing" title={OVERALL_COLUMNS.promotionRuns.note}>
                        ?
                      </span>
                    </td>
                  </tr>
                );
              })}
              {fleetMachines.length === 0 && !loadingFleetTable ? (
                <tr>
                  <td colSpan={20} className="muted">
                    No machines returned. If Red Flags shows machines, check server{' '}
                    <strong>VENDON_API_BASE</strong> / <strong>VENDON_API_KEY</strong> for{' '}
                    <code style={{ fontSize: '0.88em' }}>/api/alert/machines</code> — the Overall tab needs either Vendon
                    or a Red Alert snapshot.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="surfaceHint" style={{ marginTop: 12, marginBottom: 0 }}>
          Operating hours use the Alert Admin machine profile <strong>Location hours</strong> field. Fleet tags prefer the live
          Vendon feed; snapshot metrics (tx, cleaning, reasons, vend fails) apply only when the machine is in the Red Flags
          snapshot. <strong>?</strong> = not wired yet — hover column headers for detail.
        </p>
      </section>
    </div>
  );
}
