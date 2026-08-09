import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ComparePresetPicker, type CompareSelection } from '@/components/ComparePresetPicker';
import {
  initialCompareSelection,
  persistCompareSelection,
  presetApiQueryString,
} from '@/lib/comparePresetBridge';
import { apiGet } from '@/lib/api';
import { cleaningWindowsFromAdmin, lastCleanedStatus } from '@/lib/kuwaitCleaningStatus';
import { FleetOpsToolbarExtras } from '@/components/FleetOpsToolbarExtras';
import {
  fleetRiskScore,
  isNoSalesAlert,
  lastTxAgeMinutes,
  machineMatchesSearch,
  NO_SALES_ALERT_HOURS,
} from '@/lib/fleetOpsTools';
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
import { DowntimeDetailModal } from '@/components/DowntimeDetailModal';
import { AlertTableHeader } from '@/components/AlertTableHeader';
import { StitchOpsPanel } from '@/components/StitchOpsPanel';
import type { StitchKpi } from '@/components/StitchKpiStrip';
import { V2GhostBtn, V2KpiCard, V2Panel } from '@/features/v2/v2Ui';
import { useAuth } from '@/context/AuthContext';
import { useAlertUiTheme } from '@/lib/useAlertUiTheme';
import { ProOverallView, type ProOverallCard } from '@/features/pro/ProOverallView';
import { formatLastTxCompact } from '@/features/redflags/redFlagsFreqUi';
import { resolveLatestOperatorActivity } from '@/components/OperatorActivityCell';
import { formatKuwaitActivityStamp } from '@/lib/formatKuwait';
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
  is_active?: boolean;
  inactiveToday?: boolean;
  inactiveLabel?: string | null;
  inactive_schedule?: unknown;
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

export function OverallPage({
  variant = 'classic',
}: {
  variant?: 'classic' | 'manus';
} = {}) {
  const manus = variant === 'manus';
  const [compare, setCompare] = useState<CompareSelection>(() => initialCompareSelection());
  const { user } = useAuth();
  const { stored: columnStored, setColumns: handleColumnsChange, syncState: columnSyncState } =
    useOverallColumnPrefs(user?.email);
  const visibleColumns = useMemo(
    () => visibleOverallColumns(columnStored),
    [columnStored],
  );
  const [salesDetail, setSalesDetail] = useState<FleetRowBundle | null>(null);
  const [downtimeDetail, setDowntimeDetail] = useState<FleetRowBundle | null>(null);
  const [fleetSearch, setFleetSearch] = useState('');
  const [riskSort, setRiskSort] = useState(false);
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

  const areaOwnerMapQ = useQuery({
    queryKey: ['alert-area-owner-map'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { name?: string; vendonUserId?: string }> }>(
        '/api/alert/area-owner-map',
      ),
    refetchInterval: 60_000,
    staleTime: 2 * 60_000,
  });

  const vendonSummaryQ = useQuery({
    queryKey: ['alert-overall-vendon-sales-summary', compare.preset, compare.a.start, compare.a.end, compare.b.start, compare.b.end],
    queryFn: () =>
      apiGet<VendonSalesSummaryResponse>(
        `/api/alert/overall/vendon-sales-summary?${presetApiQueryString(compare.preset, compare)}`,
      ),
    refetchInterval: 5 * 60_000,
  });

  const downtimeQ = useQuery({
    queryKey: [
      'alert-overall-downtime-summary',
      compare.preset,
      compare.a.start,
      compare.a.end,
      compare.b.start,
      compare.b.end,
    ],
    queryFn: () =>
      apiGet<import('@/lib/downtimeDisplay').DowntimeSummaryResponse>(
        `/api/alert/overall/downtime-summary?${presetApiQueryString(compare.preset, compare)}`,
      ),
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
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

  const operatorActivityQ = useQuery({
    queryKey: ['alert-operator-activity', fleetMachineIdsKey, 14],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<string, import('@/components/OperatorActivityCell').OperatorActivityTimes>;
      }>(
        fleetMachineIdsKey
          ? `/api/alert/operator-activity?machines=${encodeURIComponent(fleetMachineIdsKey)}&days=14`
          : '/api/alert/operator-activity?days=14',
      ),
    enabled: fleetMachines.length > 0,
    staleTime: 90_000,
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
      operatorActivityByMachine: operatorActivityQ.data?.byMachineId,
      downtimeByMachine: downtimeQ.data?.byMachineId,
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
      operatorActivityQ.data?.byMachineId,
      downtimeQ.data?.byMachineId,
    ],
  );

  const onSortColumn = useCallback((key: OverallColumnKey) => {
    setColumnSort((prev) => cycleColumnSort(prev, key));
  }, []);

  const sortedFleetMachines = useMemo(() => {
    const sorted = sortFleetMachines(fleetMachines, columnSort, overallSortCtx);
    const filtered = sorted.filter((m) => machineMatchesSearch(fleetSearch, m));
    if (!riskSort) return filtered;
    const nowSec = Math.floor(Date.now() / 1000);
    return filtered.slice().sort((a, b) => {
      const snapA = snapshotByMachineId.get(a.id);
      const snapB = snapshotByMachineId.get(b.id);
      const txA = vendonLastTxQ.data?.byMachineId?.[a.id]?.timestamp;
      const txB = vendonLastTxQ.data?.byMachineId?.[b.id]?.timestamp;
      const scoreA = fleetRiskScore({
        downtimeTodaySec: downtimeQ.data?.byMachineId?.[a.id]?.todaySec,
        lastTxAgeMin:
          lastTxAgeMinutes(txA != null ? Number(txA) : null, nowSec) ??
          (snapA?.minutesSinceLastTransaction != null ? Number(snapA.minutesSinceLastTransaction) : null),
        cleaningOverdue15h: Boolean(snapA?.cleaningOverdue15h),
        reasonCount: Array.isArray(snapA?.reasons) ? snapA!.reasons!.length : 0,
        inactiveToday: Boolean((snapA as { inactiveToday?: boolean } | undefined)?.inactiveToday),
      });
      const scoreB = fleetRiskScore({
        downtimeTodaySec: downtimeQ.data?.byMachineId?.[b.id]?.todaySec,
        lastTxAgeMin:
          lastTxAgeMinutes(txB != null ? Number(txB) : null, nowSec) ??
          (snapB?.minutesSinceLastTransaction != null ? Number(snapB.minutesSinceLastTransaction) : null),
        cleaningOverdue15h: Boolean(snapB?.cleaningOverdue15h),
        reasonCount: Array.isArray(snapB?.reasons) ? snapB!.reasons!.length : 0,
        inactiveToday: Boolean((snapB as { inactiveToday?: boolean } | undefined)?.inactiveToday),
      });
      return scoreB - scoreA;
    });
  }, [
    fleetMachines,
    columnSort,
    overallSortCtx,
    fleetSearch,
    riskSort,
    snapshotByMachineId,
    vendonLastTxQ.data?.byMachineId,
    downtimeQ.data?.byMachineId,
  ]);

  const vendonSalesLabels = useMemo(
    () => ({
      primary: vendonSummaryQ.data?.labelA?.trim() || undefined,
      baseline: vendonSummaryQ.data?.labelB?.trim() || undefined,
    }),
    [vendonSummaryQ.data?.labelA, vendonSummaryQ.data?.labelB],
  );

  const fleetRevenueTotals = useMemo(() => {
    const ids = sortedFleetMachines.map((m) => m.id).filter(Boolean);
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
    sortedFleetMachines,
    compare,
    dailySalesQ.data,
    dailySalesQ.isSuccess,
    vendonSummaryQ.data?.byMachineId,
    vendonSummaryQ.data?.labelA,
    vendonSummaryQ.data?.labelB,
  ]);

  const fleetYesterdayOverall = useMemo(() => {
    if (compare.preset !== 'today_vs_yesterday') return null;
    const ids = sortedFleetMachines.map((m) => m.id).filter(Boolean);
    const kwd = fleetYesterdayFullDayKwd(dailySalesQ.data, ids, dailySalesQ.data?.byMachineId);
    const dayBefore = fleetDayBeforeFullDayKwd(dailySalesQ.data, ids, dailySalesQ.data?.byMachineId);
    return {
      kwd,
      dayBeforeKwd: dayBefore,
      trendVsDayBeforePct: resolveSalesTrendPct(null, kwd, dayBefore),
    };
  }, [compare, sortedFleetMachines, dailySalesQ.data]);

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

  const uiTheme = useAlertUiTheme();

  const proCards = useMemo((): ProOverallCard[] => {
    if (uiTheme !== 'pro') return [];
    return sortedFleetMachines.map((m) => {
      const snap = snapshotByMachineId.get(m.id);
      const live = liveByMachineId.get(m.id);
      const prof = profileByMachineId.get(m.id);
      const vendon = vendonSummaryQ.data?.byMachineId?.[m.id];
      const salesElapsed = salesElapsedForMachine(dailySalesQ.data, m.id, dailySalesQ.isSuccess);
      const salesPair = salesPairForPreset(compare.preset, salesElapsed, compare, vendon, vendonSalesLabels);
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
      const lastTxIso = txRaw ? String(txRaw) : vendonTxIso;
      const lastCleanedIso = snap?.lastCleaningAt != null ? String(snap.lastCleaningAt).trim() : '';
      const cleanIso = lastCleanedIso || String(live?.lastCleaningAt ?? '').trim();
      const cleanWins = cleaningWindowsFromAdmin(prof?.cleaning_windows);
      const cleanStatus = cleanIso
        ? lastCleanedStatus({ lastCleaningIso: cleanIso, cleaningWindows: cleanWins })
        : null;
      const latestOp = resolveLatestOperatorActivity(
        operatorActivityQ.data?.byMachineId?.[m.id],
        snap?.operatorLastAccessAt != null ? String(snap.operatorLastAccessAt) : null,
      );
      return {
        id: m.id,
        name: m.name || m.id,
        operator,
        salesPrimary: salesPair.primary,
        salesBaseline: salesPair.baseline,
        salesTrendPct: salesPair.trendPct,
        salesCaption: salesPair.caption,
        lastTx: lastTxIso ? formatLastTxCompact(lastTxIso) : '—',
        lastClean: cleanStatus?.label || (cleanIso ? formatLastTxCompact(cleanIso) : '—'),
        activityKind: latestOp?.kindShort || '—',
        activityWhen: latestOp ? formatKuwaitActivityStamp(latestOp.iso) : '—',
        flagged: snapshotByMachineId.has(m.id),
        salesRow: salesElapsed ?? null,
      };
    });
  }, [
    uiTheme,
    sortedFleetMachines,
    snapshotByMachineId,
    liveByMachineId,
    profileByMachineId,
    vendonSummaryQ.data?.byMachineId,
    dailySalesQ.data,
    dailySalesQ.isSuccess,
    compare,
    vendonSalesLabels,
    vendonLastTxQ.data?.byMachineId,
    operatorActivityQ.data?.byMachineId,
  ]);

  const location = useLocation();
  const onV2 = location.pathname.startsWith('/v2');
  if (uiTheme === 'pro' && !onV2) {
    const salesComparisonNote = presetLabels(compare.preset).caption;
    return (
      <ProOverallView
        cards={proCards}
        kpis={overallKpis}
        compare={compare}
        onCompareChange={setComparePersist}
        salesNote={salesComparisonNote}
        asOfLocal={dailySalesQ.data?.asOfLocal}
        salesMeta={dailySalesQ.data}
        loading={loadingFleetTable}
        error={
          machinesQ.isError
            ? `${(machinesQ.error as Error).message}${
                fleetFromSnapshotFallback
                  ? ' — Rows use the Red Alert snapshot so you still see machines from Red Flags.'
                  : ''
              }`
            : null
        }
        info={
          fleetFromSnapshotFallback
            ? 'Fleet list built from the Red Alert snapshot (Vendon list unavailable).'
            : null
        }
        fetching={isRefreshing}
        fleetPrimaryKwd={fleetRevenueTotals.primary}
        fleetBaselineKwd={fleetRevenueTotals.baseline}
        fleetTrendPct={fleetRevenueTotals.trendPct}
        onRefresh={refetchAll}
      />
    );
  }

  const boardInner = (
    <>
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
                const areaOwnerPerson = String(areaOwnerMapQ.data?.byMachineId?.[m.id]?.name ?? '').trim();
                const locationOwner = areaOwnerPerson || adminLocationOwner || vendonTagOwner;
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
                  cleaningWindows: cleanWins,
                  noSalesAlert: (() => {
                    const ageFromSnap =
                      snap?.minutesSinceLastTransaction != null
                        ? Number(snap.minutesSinceLastTransaction)
                        : snap?.minutes_since_last_transaction != null
                          ? Number(snap.minutes_since_last_transaction)
                          : null;
                    const txTs = vendonTx?.timestamp;
                    const age =
                      ageFromSnap ?? lastTxAgeMinutes(txTs != null ? Number(txTs) : null);
                    return isNoSalesAlert(age);
                  })(),
                  noSalesHours: NO_SALES_ALERT_HOURS,
                  vendFailSummary,
                  mostIssue,
                  downtimeRow: downtimeQ.data?.byMachineId?.[m.id] ?? null,
                  downtimeTodayLabel: downtimeQ.data?.labelToday?.trim() || 'Today',
                  downtimePeriodLabel: downtimeQ.data?.labelPeriod?.trim() || 'Period',
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
                  // Findings Slack errors must not blank QA/Tech visit cells.
                  qaError: qaSummaryQ.data?.error || null,
                  operatorActivity: operatorActivityQ.data?.byMachineId?.[m.id] ?? null,
                  comparePreset: compare.preset,
                  snapTime: snapQ.data?.generatedAt ?? snapQ.data?.cacheGeneratedAt ?? null,
                  dailyTargetKd,
                  workflowLoaded: workflowAttendanceQ.isFetched,
                  cleaningOverdue15h: !!snap?.cleaningOverdue15h,
                  adminMetaHintParts,
                  locationOwner,
                  locHours,
                  adminLocationOwner: areaOwnerPerson || adminLocationOwner,
                  vendonTagOwner: areaOwnerPerson ? adminLocationOwner || vendonTagOwner : vendonTagOwner,
                  machineInactive: prof?.inactiveToday === true || prof?.is_active === false,
                  machineInactiveLabel:
                    String(prof?.inactiveLabel || (prof?.is_active === false ? 'Inactive' : 'Inactive today')).trim() ||
                    'Inactive',

                };
                return (
                  <OverallFleetRow
                    key={m.id}
                    bundle={{
                      ...bundle,
                      onOpenDowntime: () => setDowntimeDetail(bundle),
                    }}
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
    </>
  );

  const fleetBar =
    fleetMachines.length > 0 ? (
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
    ) : null;

  const modals = (
    <>
      {salesDetail && salesDetail.salesElapsed ? (
        <SalesHistoryModal
          machineName={salesDetail.m.name}
          machineId={salesDetail.m.id}
          row={salesDetail.salesElapsed}
          meta={dailySalesQ.data}
          onClose={() => setSalesDetail(null)}
        />
      ) : null}
      {downtimeDetail ? (
        <DowntimeDetailModal
          machineName={downtimeDetail.m.name}
          machineId={downtimeDetail.m.id}
          todayLabel={downtimeDetail.downtimeTodayLabel || 'Today'}
          periodLabel={downtimeDetail.downtimePeriodLabel || 'Period'}
          todaySec={downtimeDetail.downtimeRow?.todaySec}
          periodSec={downtimeDetail.downtimeRow?.periodSec}
          trendPct={downtimeDetail.downtimeRow?.trendPct}
          onClose={() => setDowntimeDetail(null)}
        />
      ) : null}
    </>
  );

  if (manus) {
    return (
      <div className="pageShellWide v2ManusBoard">
        <div className="v2KpiGrid">
          {overallKpis.map((k) => (
            <V2KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              detail={k.sub || ''}
              tone={k.tone === 'warn' ? 'amber' : k.tone === 'good' ? 'teal' : 'blue'}
              icon="overall"
            />
          ))}
        </div>
        <V2Panel
          title="Fleet workbook"
          subtitle={`${fleetMachines.length} machines · ${visibleColumns.length} Classic fields`}
          meta={
            <V2GhostBtn onClick={refetchAll} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </V2GhostBtn>
          }
        >
          {boardInner}
        </V2Panel>
        {fleetBar}
        {modals}
      </div>
    );
  }

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
            <FleetOpsToolbarExtras
              search={fleetSearch}
              onSearchChange={setFleetSearch}
              riskSort={riskSort}
              onRiskSortChange={setRiskSort}
            />
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
        {boardInner}
      </StitchOpsPanel>
      {fleetBar}
      {modals}
    </div>
  );
}
