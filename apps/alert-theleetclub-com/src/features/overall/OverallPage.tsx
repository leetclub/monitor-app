import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ComparePresetPicker, type CompareSelection } from '@/components/ComparePresetPicker';
import {
  initialCompareSelection,
  persistCompareSelection,
  presetApiQueryString,
} from '@/lib/comparePresetBridge';
import { apiGet } from '@/lib/api';
import { cleaningWindowsFromAdmin, lastCleanedStatus } from '@/lib/kuwaitCleaningStatus';
import { fetchCleaningWorkflowMapBatched, fetchMachineAttendanceMapBatched } from '@/lib/leetWorkflowApi';
import { freshnessNotice } from '@/lib/dataFreshness';
import { safeText } from '@/lib/safeText';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import {
  OVERALL_COLUMNS,
  type OverallColumnKey,
} from './overallWorkbookColumns';
import { OverallFleetRow, overallHeaderClass, type FleetRowBundle } from './overallFleetCells';
import { SalesHistoryModal } from '@/components/SalesHistoryModal';
import { AlertTableHeader } from '@/components/AlertTableHeader';
import { StitchOpsPanel } from '@/components/StitchOpsPanel';
import type { StitchKpi } from '@/components/StitchKpiStrip';
import { useAuth } from '@/context/AuthContext';
import { useOverallColumnPrefs } from '@/lib/useOverallColumnPrefs';
import { visibleOverallColumns } from './overallColumnVisibility';
import { OverallColumnPicker } from './OverallColumnPicker';
import { TableScrollControls } from '@/components/TableScrollControls';
import {
  salesElapsedForMachine,
  resolveSalesTrendPct,
  type DailySalesElapsedResponse,
} from '@/lib/salesDisplay';
import { OVERALL_TABLE_HEADERS } from '@/lib/tableHeaderLabels';
import {
  qaFindingsForMachineName,
  qaVisitForMachineName,
  techVisitForMachineName,
  type QaFindingsResponse,
  type QaSummaryResponse,
} from '@/lib/qaVisitDisplay';
import {
  aggregateFleetSalesForPreset,
  applyApiFleetElapsedTotals,
  fleetYesterdayFullDayKwd,
  fleetDayBeforeFullDayKwd,
  footfallDisplayForPreset,
  presetLabels,
  salesPairForPreset,
} from '@/lib/presetComparison';
import { OpsRevenueTotalsBar } from '@/components/OpsRevenueTotalsBar';
import rfStyles from '@/features/redflags/RedFlagsBoard.module.css';
import styles from './OverallPage.module.css';
import { cycleColumnSort, sortDirForColumn, type ColumnSortState } from '@/lib/tableColumnSort';
import {
  OVERALL_SORTABLE_COLUMNS,
  sortFleetMachines,
  type OverallSortContext,
} from './overallTableSort';

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
  dateAStart?: string;
  dateBStart?: string;
  labelA?: string;
  labelB?: string;
  byMachineId: Record<
    string,
    {
      aSalesKwd: number | null;
      bSalesKwd: number | null;
      trendPct: number | null;
      peakHour?: { hour: number; count: number; label: string } | null;
      peakHourFromYesterday?: boolean;
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
  lastQcVisitAt?: string | null;
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

type WasteByMachineRow = {
  wastePct?: number | null;
  error?: string | null;
  totalWaste?: number;
  totalSales?: number;
  note?: string;
};

type WasteByMachineResponse = {
  date: string;
  byMachineId?: Record<string, WasteByMachineRow>;
  skipped?: boolean;
  reason?: string;
  machinesProcessed?: number;
};

type PeopleFootfallRow = {
  mapped?: boolean;
  todayIn?: number | null;
  yesterdayIn?: number | null;
  primaryIn?: number | null;
  baselineIn?: number | null;
  trendPct?: number | null;
  primaryLabel?: string | null;
  baselineLabel?: string | null;
  uidds?: string[];
  resolve?: string;
  hint?: string | null;
};

type PeopleFootfallResponse = {
  timezone: string;
  preset?: string;
  today: string;
  yesterday: string;
  labelA?: string;
  labelB?: string;
  videoloftDevicesLoaded?: boolean;
  byMachineId?: Record<string, PeopleFootfallRow>;
  machinesProcessed?: number;
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
  if (delta <= 10) return { label: 'Late', color: 'y' };
  if (delta <= 20) return { label: 'Tardy', color: 'o' };
  return { label: 'Absent', color: 'r' };
}

export function OverallPage() {
  const [compare, setCompare] = useState<CompareSelection>(() => initialCompareSelection());
  const { user } = useAuth();
  const { stored: columnStored, setColumns: handleColumnsChange, syncState: columnSyncState } =
    useOverallColumnPrefs(user?.email);
  const visibleColumns = useMemo(
    () => visibleOverallColumns(columnStored),
    [columnStored],
  );
  const [salesDetail, setSalesDetail] = useState<FleetRowBundle | null>(null);
  const [columnSort, setColumnSort] = useState<ColumnSortState<OverallColumnKey>>({
    column: null,
    dir: null,
  });
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
    queryKey: ['alert-overall-vendon-sales-summary', compare.preset, compare.a.start, compare.a.end, compare.b.start, compare.b.end],
    queryFn: () =>
      apiGet<VendonSalesSummaryResponse>(
        `/api/alert/overall/vendon-sales-summary?${presetApiQueryString(compare.preset, compare)}`,
      ),
    refetchInterval: 5 * 60_000,
  });

  const dailySalesQ = useQuery({
    queryKey: ['alert-overall-daily-sales-elapsed', compare.preset],
    queryFn: () => apiGet<DailySalesElapsedResponse>('/api/alert/overall/daily-sales-elapsed'),
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnMount: 'always',
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

  /** Same computation as Monitor v1 waste-tab.js (motion area-overrides + Vendon vends). Kuwait calendar day default. */
  const wasteByMachineQ = useQuery({
    queryKey: ['alert-overall-waste-by-machine'],
    queryFn: () => apiGet<WasteByMachineResponse>('/api/alert/overall/waste-by-machine'),
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const peopleFootfallQ = useQuery({
    queryKey: ['alert-overall-people-footfall', compare.preset, compare.a.start, compare.a.end, compare.b.start, compare.b.end],
    queryFn: () =>
      apiGet<PeopleFootfallResponse>(
        `/api/alert/overall/people-footfall?${presetApiQueryString(compare.preset, compare)}`,
      ),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const qaSummaryQ = useQuery({
    queryKey: ['alert-qa-summary'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
  });

  const qaFindingsQ = useQuery({
    queryKey: ['alert-qa-findings'],
    queryFn: () => apiGet<QaFindingsResponse>('/api/alert/qa/findings'),
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const mtdVendonQ = useQuery({
    queryKey: ['alert-overall-vendon-mtd'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { aSalesKwd?: number | null }> }>(
        '/api/alert/overall/vendon-sales-summary?preset=mtd_vs_mtd',
      ),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const mtdYoyVendonQ = useQuery({
    queryKey: ['alert-overall-vendon-mtd-yoy'],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<
          string,
          { aSalesKwd?: number | null; bSalesKwd?: number | null; trendPct?: number | null }
        >;
      }>('/api/alert/overall/vendon-sales-summary?preset=mtd_vs_yoy'),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
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

  const fleetMachineIdsKey = useMemo(() => {
    const ids = fleetMachines.map((m) => m.id).filter(Boolean);
    ids.sort();
    return ids.join(',');
  }, [fleetMachines]);

  const workflowAttendanceQ = useQuery({
    queryKey: ['leet-workflow-attendance-map', fleetMachineIdsKey],
    queryFn: () => fetchMachineAttendanceMapBatched(fleetMachines.map((m) => m.id)),
    enabled: fleetMachines.length > 0,
    staleTime: 2 * 60_000,
    refetchInterval: 3 * 60_000,
  });

  const workflowCleaningQ = useQuery({
    queryKey: ['leet-workflow-cleaning-map', fleetMachineIdsKey],
    queryFn: () => fetchCleaningWorkflowMapBatched(fleetMachines.map((m) => m.id)),
    enabled: fleetMachines.length > 0,
    staleTime: 2 * 60_000,
    refetchInterval: 3 * 60_000,
  });

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

  const overallSortCtx = useMemo(
    (): OverallSortContext => ({
      compare,
      snapshotById: snapshotByMachineId,
      profileById: profileByMachineId,
      dailySales: dailySalesQ.data,
      dailySalesReady: dailySalesQ.isSuccess,
      vendonByMachine: vendonSummaryQ.data?.byMachineId,
      mtdByMachine: mtdVendonQ.data?.byMachineId,
      mtdReady: mtdVendonQ.isSuccess && Boolean(mtdVendonQ.data?.byMachineId),
      mtdYoyByMachine: mtdYoyVendonQ.data?.byMachineId,
      mtdYoyReady: mtdYoyVendonQ.isSuccess && Boolean(mtdYoyVendonQ.data?.byMachineId),
      lastTxByMachine: vendonLastTxQ.data?.byMachineId,
      liveById: liveByMachineId,
      wasteByMachine: wasteByMachineQ.data?.byMachineId,
      footfallByMachine: peopleFootfallQ.data?.byMachineId,
      qaSummary: qaSummaryQ.data,
    }),
    [
      compare,
      snapshotByMachineId,
      profileByMachineId,
      dailySalesQ.data,
      dailySalesQ.isSuccess,
      vendonSummaryQ.data?.byMachineId,
      mtdVendonQ.data,
      mtdVendonQ.isSuccess,
      mtdYoyVendonQ.data,
      mtdYoyVendonQ.isSuccess,
      vendonLastTxQ.data?.byMachineId,
      liveByMachineId,
      wasteByMachineQ.data?.byMachineId,
      peopleFootfallQ.data?.byMachineId,
      qaSummaryQ.data,
    ],
  );

  const onSortColumn = useCallback((key: OverallColumnKey) => {
    setColumnSort((prev) => cycleColumnSort(prev, key));
  }, []);

  const sortedFleetMachines = useMemo(
    () => sortFleetMachines(fleetMachines, columnSort, overallSortCtx),
    [fleetMachines, columnSort, overallSortCtx],
  );

  const vendonSalesLabels = useMemo(
    () => ({
      primary: vendonSummaryQ.data?.labelA?.trim() || undefined,
      baseline: vendonSummaryQ.data?.labelB?.trim() || undefined,
    }),
    [vendonSummaryQ.data?.labelA, vendonSummaryQ.data?.labelB],
  );

  const fleetRevenueTotals = useMemo(() => {
    const ids = fleetMachines.map((m) => m.id).filter(Boolean);
    const rowTotals = aggregateFleetSalesForPreset(
      ids,
      compare.preset,
      compare,
      dailySalesQ.data?.byMachineId,
      vendonSummaryQ.data?.byMachineId,
      { labelA: vendonSummaryQ.data?.labelA, labelB: vendonSummaryQ.data?.labelB },
      { dailySalesReady: dailySalesQ.isSuccess },
    );
    return applyApiFleetElapsedTotals(compare.preset, rowTotals, dailySalesQ.data, dailySalesQ.isSuccess);
  }, [
    fleetMachines,
    compare,
    dailySalesQ.data,
    dailySalesQ.isSuccess,
    vendonSummaryQ.data?.byMachineId,
    vendonSummaryQ.data?.labelA,
    vendonSummaryQ.data?.labelB,
  ]);

  const fleetYesterdayOverall = useMemo(() => {
    if (compare.preset !== 'today_vs_yesterday') return null;
    const ids = fleetMachines.map((m) => m.id).filter(Boolean);
    const kwd = fleetYesterdayFullDayKwd(dailySalesQ.data, ids, dailySalesQ.data?.byMachineId);
    const dayBefore = fleetDayBeforeFullDayKwd(dailySalesQ.data, ids, dailySalesQ.data?.byMachineId);
    return {
      kwd,
      trendVsDayBeforePct: resolveSalesTrendPct(null, kwd, dayBefore),
    };
  }, [compare, fleetMachines, dailySalesQ.data]);

  const snapshotMachineCount = snapshotByMachineId.size;

  const salesComparisonNote = useMemo(
    () => presetLabels(compare.preset).caption,
    [compare.preset],
  );

  const isRefreshing =
    machinesQ.isFetching ||
    snapQ.isFetching ||
    profilesQ.isFetching ||
    vendonSummaryQ.isFetching ||
    dailySalesQ.isFetching ||
    vendonLastTxQ.isFetching ||
    liveSnapQ.isFetching ||
    wasteByMachineQ.isFetching ||
    peopleFootfallQ.isFetching ||
    mtdVendonQ.isFetching ||
    mtdYoyVendonQ.isFetching ||
    qaSummaryQ.isFetching ||
    qaFindingsQ.isFetching ||
    workflowAttendanceQ.isFetching;

  const refetchAll = useCallback(() => {
    void Promise.all([
      machinesQ.refetch(),
      snapQ.refetch(),
      profilesQ.refetch(),
      vendonSummaryQ.refetch(),
      dailySalesQ.refetch(),
      vendonLastTxQ.refetch(),
      liveSnapQ.refetch(),
      wasteByMachineQ.refetch(),
      peopleFootfallQ.refetch(),
      mtdVendonQ.refetch(),
      mtdYoyVendonQ.refetch(),
      qaSummaryQ.refetch(),
      qaFindingsQ.refetch(),
      workflowAttendanceQ.refetch(),
    ]);
  }, [
    machinesQ,
    snapQ,
    profilesQ,
    vendonSummaryQ,
    dailySalesQ,
    vendonLastTxQ,
    liveSnapQ,
    wasteByMachineQ,
    peopleFootfallQ,
    mtdVendonQ,
    mtdYoyVendonQ,
    qaSummaryQ,
    qaFindingsQ,
    workflowAttendanceQ,
  ]);

  const overallKpis = useMemo((): StitchKpi[] => {
    const presetShort =
      compare.preset === 'today_vs_yesterday'
        ? 'Today'
        : compare.preset === 'yesterday_vs_day_before'
          ? 'Yest.'
          : compare.preset === 'wtd_vs_last_week'
            ? 'WTD'
            : compare.preset === 'mtd_vs_mtd'
              ? 'MTD'
              : 'Custom';
    return [
      { label: 'Fleet', value: String(fleetMachines.length), sub: 'machines' },
      {
        label: 'Red Flags',
        value: String(snapshotMachineCount),
        sub: 'in snapshot',
        tone: snapshotMachineCount > 0 ? 'warn' : 'good',
      },
      { label: 'Admin', value: String(profileByMachineId.size), sub: 'profiles' },
      { label: 'Compare', value: presetShort, sub: 'timespan' },
    ];
  }, [fleetMachines.length, snapshotMachineCount, profileByMachineId.size, compare.preset]);

  return (
    <div className="pageShellWide">
      <StitchOpsPanel
        compact
        iconName="overall"
        title="Overall"
        badge={`${fleetMachines.length} machines`}
        kpis={overallKpis}
        toolbar={
          <>
            <span className="stitchOpsLive">
              <span className="stitchOpsLiveDot" aria-hidden />
              Auto · ~1m
            </span>
            <button type="button" className="stitchOpsRefresh stitchOpsRefreshCompact" onClick={refetchAll} disabled={isRefreshing}>
              {isRefreshing ? '…' : 'Refresh'}
            </button>
          </>
        }
      >
        <div className="opsPrepCompact">
          <div className="opsPrepRow">
            <div className="stitchOpsControls opsPrepControls">
              <ComparePresetPicker value={compare} onChange={setComparePersist} />
            </div>
          </div>
          <OverallColumnPicker
            compact
            stored={columnStored}
            visibleKeys={visibleColumns}
            visibleCount={visibleColumns.length}
            syncState={columnSyncState}
            onChange={handleColumnsChange}
          />
          <p className="opsPrepSalesLine">
            <strong>Sales</strong> — {salesComparisonNote}
            {dailySalesQ.data?.asOfLocal ? ` · ${dailySalesQ.data.asOfLocal.replace('T', ' ')} KWT` : ''}
          </p>
        </div>

        {machinesQ.isError ? (
          <p className="stitchOpsAlert opsAlertInline" role="alert">
            {(machinesQ.error as Error).message}
            {fleetFromSnapshotFallback
              ? ' — Rows use the Red Alert snapshot so you still see machines from Red Flags.'
              : ''}
          </p>
        ) : null}
        {fleetFromSnapshotFallback ? (
          <p className="stitchOpsAlert stitchOpsAlertInfo opsAlertInline">
            Fleet list built from the <strong>Red Alert snapshot</strong> (Vendon list unavailable).
          </p>
        ) : null}
        {snapQ.isError ? (
          <p className="stitchOpsAlert opsAlertInline" role="alert">
            Red Alert snapshot failed: {(snapQ.error as Error).message}. Last transaction merge may be incomplete.
          </p>
        ) : null}
        {fleetMachines.length > 0 && snapshotMachineCount < fleetMachines.length ? (
          <p className="stitchOpsAlert stitchOpsAlertInfo opsAlertInline">
            Snapshot columns apply to {snapshotMachineCount} of {fleetMachines.length} rows.
          </p>
        ) : null}

        <section className="opsDashboardSection opsDashboardSection--data" aria-label="Fleet table">
          <div className="opsDashboardSectionBody opsDashboardSectionBody--data">
          <div className="opsTableLead">
            <span className="opsTableLeadTitle">Fleet</span>
            <span className="opsDashboardSectionBadge">
              {fleetMachines.length} rows · {visibleColumns.length} cols
            </span>
          </div>
        <TableScrollControls scrollerClassName={styles.fleetWrap}>
          <table className={`${rfStyles.table} stitchOpsTable`}>
            <thead>
              <tr>
                {visibleColumns.map((key) => (
                  <AlertTableHeader
                    key={key}
                    label={OVERALL_TABLE_HEADERS[key]}
                    title={headerTooltip(key)}
                    className={overallHeaderClass(key)}
                    sortable={OVERALL_SORTABLE_COLUMNS.has(key)}
                    sortDir={sortDirForColumn(columnSort, key)}
                    onSortClick={
                      OVERALL_SORTABLE_COLUMNS.has(key) ? () => onSortColumn(key) : undefined
                    }
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingFleetTable ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="muted">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {sortedFleetMachines.map((m) => {
                const snap = snapshotByMachineId.get(m.id);
                const live = liveByMachineId.get(m.id);
                const mins = snap?.minutesSinceLastTransaction ?? snap?.minutes_since_last_transaction;
                const minsOk = mins != null && typeof mins === 'number' && !Number.isNaN(mins);
                const prof = profileByMachineId.get(m.id);
                const vendon = vendonSummaryQ.data?.byMachineId?.[m.id];
                const locHours = String(prof?.location_hours ?? '').trim();
                const adminLocationOwner = String(prof?.location_owner ?? '').trim();
                const vendonTagOwner = String(m.vendon_location_owner ?? '').trim();
                const locationOwner = adminLocationOwner || vendonTagOwner;
                const lastCleanedIso = snap?.lastCleaningAt != null ? String(snap.lastCleaningAt).trim() : '';
                const vendFailSummary = snapshotVendFailSummary(snap);
                const mostIssue = snapshotMostIssue(snap);
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
                const peakHourCount =
                  vendon?.peakHour?.count != null && Number.isFinite(Number(vendon.peakHour.count))
                    ? Number(vendon.peakHour.count)
                    : null;
                const peakHourFromYesterday = Boolean(vendon?.peakHourFromYesterday);
                const topProduct = vendon?.topProduct?.name || '';
                const lowProduct = vendon?.lowProduct?.name || '';
                const salesElapsed = salesElapsedForMachine(dailySalesQ.data, m.id, dailySalesQ.isSuccess);
                const mtdSalesKwd = mtdVendonQ.data?.byMachineId?.[m.id]?.aSalesKwd;
                const mtdYoyRow = mtdYoyVendonQ.data?.byMachineId?.[m.id];
                const footfallEntry = peopleFootfallQ.data?.byMachineId?.[m.id];
                const salesPair = salesPairForPreset(
                  compare.preset,
                  salesElapsed,
                  compare,
                  vendon,
                  vendonSalesLabels,
                );
                const footfallPair = footfallDisplayForPreset(compare.preset, footfallEntry, footfallEntry);
                const presetTargetPct =
                  live?.dailyTarget != null &&
                  Number(live.dailyTarget) > 0 &&
                  salesPair.primary != null &&
                  Number.isFinite(salesPair.primary)
                    ? (salesPair.primary / Number(live.dailyTarget)) * 100
                    : null;
                const liveTargetPct =
                  presetTargetPct ??
                  (live?.dailyTarget != null && Number(live.dailyTarget) > 0
                    ? (Number(live?.salesToday ?? 0) / Number(live.dailyTarget)) * 100
                    : null);
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
                const wasteEntry = wasteByMachineQ.data?.byMachineId?.[m.id];
                const wastePct = wasteEntry?.wastePct;
                const qaVisit = qaVisitForMachineName(
                  m.name || m.id,
                  qaSummaryQ.data?.byLocationKey,
                  qaSummaryQ.data?.adminSummaryMtdByMachine,
                  qaSummaryQ.data?.latestByMachine,
                );
                const techVisit = techVisitForMachineName(m.name || m.id, qaSummaryQ.data?.byLocationKeyTech);
                const qaFindings = qaFindingsForMachineName(m.name || m.id, qaFindingsQ.data?.findings);
                const qcIso =
                  (qaVisit?.lastVisitAt ? String(qaVisit.lastVisitAt).trim() : '') ||
                  (live?.lastQcVisitAt ? String(live.lastQcVisitAt).trim() : '');
                const techIso = techVisit?.lastVisitAt ? String(techVisit.lastVisitAt).trim() : '';
                const dailyTargetKd =
                  snap?.dailyTarget != null && Number.isFinite(Number(snap.dailyTarget))
                    ? Number(snap.dailyTarget)
                    : live?.dailyTarget != null && Number.isFinite(Number(live.dailyTarget))
                      ? Number(live.dailyTarget)
                      : null;
                const bundle: FleetRowBundle = {
                  m,
                  snap,
                  live,
                  prof,
                  vendon,
                  salesElapsed,
                  salesPair,
                  mtdSalesKwd,
                  mtdYoySalesKwd: mtdYoyRow?.aSalesKwd,
                  mtdYoyLyKwd: mtdYoyRow?.bSalesKwd,
                  mtdYoyTrendPct: mtdYoyRow?.trendPct,
                  footfallPair,
                  vendonTxIso,
                  wastePct: wastePct ?? undefined,
                  wasteSkipped: wasteByMachineQ.data?.skipped,
                  wasteReason: wasteByMachineQ.data?.reason,
                  wasteDate: wasteByMachineQ.data?.date,
                  wasteError: wasteEntry?.error ?? null,
                  footfall: footfallEntry,
                  footfallTz: peopleFootfallQ.data?.timezone,
                  operatingDaysLabel: daysLabel,
                  operatorHoursSummary: opHours,
                  attendance: att,
                  workflowAttendance: workflowAttendanceQ.data?.byMachineId?.[m.id],
                  workflowCleaning: workflowCleaningQ.data?.byMachineId?.[m.id],
                  workflowConfigured: workflowAttendanceQ.data?.configured !== false,
                  cleanIso,
                  cleanStatus,
                  vendFailSummary,
                  mostIssue,
                  operator,
                  txRaw,
                  minsOk,
                  mins,
                  peakHourLabel,
                  peakHourCount,
                  peakHourFromYesterday,
                  topProduct,
                  lowProduct,
                  liveTargetPct,
                  qcIso,
                  techIso,
                  qaVisit,
                  techVisit,
                  qaFindings,
                  qaLoading: qaSummaryQ.isLoading || qaFindingsQ.isLoading,
                  qaError: qaSummaryQ.data?.error || qaFindingsQ.data?.error || null,
                  comparePreset: compare.preset,
                  snapTime: snapQ.data?.generatedAt ?? snapQ.data?.cacheGeneratedAt ?? null,
                  dailyTargetKd,
                  workflowLoaded: workflowAttendanceQ.isFetched,
                  cleaningOverdue15h: !!snap?.cleaningOverdue15h,
                  adminMetaHintParts,
                  locationOwner,
                  locHours,
                  adminLocationOwner,
                  vendonTagOwner,
                };
                return (
                  <OverallFleetRow
                    key={m.id}
                    bundle={bundle}
                    columns={visibleColumns}
                    onSalesDetail={setSalesDetail}
                  />
                );
              })}
              {fleetMachines.length === 0 && !loadingFleetTable ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="muted">
                    No machines returned. If Red Flags shows machines, check server{' '}
                    <strong>VENDON_API_BASE</strong> / <strong>VENDON_API_KEY</strong> for{' '}
                    <code style={{ fontSize: '0.88em' }}>/api/alert/machines</code> — the Overall tab needs either Vendon
                    or a Red Alert snapshot.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScrollControls>
          </div>
        </section>
      </StitchOpsPanel>

      {fleetMachines.length > 0 ? (
        <OpsRevenueTotalsBar
          totals={fleetRevenueTotals}
          machineCount={fleetRevenueTotals.machineCount}
          loading={fleetRevenueTotals.loading}
          asOfLocal={dailySalesQ.data?.asOfLocal}
          salesFreshnessNote={
            dailySalesQ.isFetched
              ? freshnessNotice('minute', dailySalesQ.data?.cacheGeneratedAt ?? dailySalesQ.data?.asOfLocal, {
                  fetching: dailySalesQ.isFetching,
                })
              : null
          }
          yesterdayOverall={fleetYesterdayOverall}
        />
      ) : null}

      {salesDetail && salesDetail.salesElapsed ? (
        <SalesHistoryModal
          machineName={salesDetail.m.name}
          machineId={salesDetail.m.id}
          row={salesDetail.salesElapsed}
          meta={dailySalesQ.data}
          onClose={() => setSalesDetail(null)}
        />
      ) : null}
    </div>
  );
}
