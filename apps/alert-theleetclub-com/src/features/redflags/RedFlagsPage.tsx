import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ComparePresetPicker, type CompareSelection } from '@/components/ComparePresetPicker';
import {
  comparePresetToRedAlertMode,
  freqHeadingForComparePreset,
  initialCompareSelection,
  persistCompareSelection,
  presetApiQueryString,
} from '@/lib/comparePresetBridge';
import { apiGet } from '@/lib/api';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { cleaningWindowsFromAdmin, lastCleanedStatus } from '@/lib/kuwaitCleaningStatus';
import { FleetOpsToolbarExtras } from '@/components/FleetOpsToolbarExtras';
import {
  fleetRiskScore,
  isNoSalesAlert,
  lastTxAgeMinutes,
  machineMatchesSearch,
  NO_SALES_ALERT_HOURS,
} from '@/lib/fleetOpsTools';
import { useSlackUserMap } from '@/lib/useSlackUserMap';
import type { RedAlertCompareMode, RedAlertDetailPayload, RedAlertRow } from './redAlertTypes';
import {
  baselineReasonMap,
  buildDetailPayload,
  filterSnapshotRows,
  freqBoxVisuals,
  freqSplit,
  getMachineIdRaw,
  getOperatorDisplayName,
  resolveOperatorStrikeEmail,
  getStrikeOperatorEmail,
  pickLastCleaningIso,
  rankRows,
  reasonKey,
  rowHappensForSort,
  type FreqSplit,
  type RankedRedAlertRow,
} from './redFlagsModel';
import { GoCheckWorkflowModal } from '@/components/GoCheckWorkflowModal';
import { DowntimeDetailModal } from '@/components/DowntimeDetailModal';
import { ProductExtremesModal } from '@/components/ProductExtremesModal';
import { formatAgeShort } from '@/lib/dataFreshness';
import {
  aggregateFleetSalesForPreset,
  applyApiFleetElapsedTotals,
  fleetYesterdayFullDayKwd,
  fleetDayBeforeFullDayKwd,
  presetLabels,
  salesPairForPreset,
  targetKwdForPreset,
} from '@/lib/presetComparison';
import { OpsRevenueTotalsBar } from '@/components/OpsRevenueTotalsBar';
import { SalesHistoryModal } from '@/components/SalesHistoryModal';
import { TrendHistoryModal } from '@/components/TrendHistoryModal';
import { OperatorContactSection } from '@/components/OperatorContactSection';
import { TargetDetailModal } from '@/components/TargetDetailModal';
import { SxDetailModal } from '@/components/SxDetailModal';
import type { SxAccelerationRow } from '@/components/SxAccelerationCell';
import { isRowInteractiveTarget, captureRowTapTarget, handleRowClickActivate } from '@/lib/stopRowClick';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';
import { buildFreqColumnContext, type FreqColumnContext } from '@/lib/freqColumnContext';
import { formatLastTxCompact } from './redFlagsFreqUi';
import { TrendBreakdownPanel } from '@/components/TrendBreakdownPanel';
import {
  canOpenIncidentHistory,
  trendHistoryComparisons,
  incidentsElapsedForMachine,
  resolveIncidentsRow,
  type DailyIncidentsElapsedResponse,
  type IncidentsElapsedRow,
} from '@/lib/incidentsDisplay';
import {
  type DailySalesElapsedResponse,
  formatFleetRevenueCacheTrustNote,
  formatKwd,
  formatSalesTrendPct,
  resolveSalesTrendPct,
  salesDayKwd,
  salesElapsedForMachine,
  type SalesElapsedRow,
} from '@/lib/salesDisplay';
import { qaVisitForMachineName, qaFindingsForMachineName, techVisitForMachineName, type QaFindingsResponse, type QaSummaryResponse } from '@/lib/qaVisitDisplay';
import {
  requestCleaningNotificationPermission,
  useCleaningOverdueAlerts,
} from '@/lib/useCleaningOverdueAlerts';
import { fetchCleaningWorkflowMapBatched, fetchMachineAttendanceMapBatched, type MachineAttendanceSummary } from '@/lib/leetWorkflowApi';
import { StitchOpsPanel } from '@/components/StitchOpsPanel';
import { V2GhostBtn, V2KpiCard, V2Panel } from '@/features/v2/v2Ui';
import { TableScrollControls } from '@/components/TableScrollControls';
import { RedFlagsColumnPicker } from './RedFlagsColumnPicker';
import { visibleRedFlagsColumns } from './redFlagsColumnVisibility';
import { useAuth } from '@/context/AuthContext';
import { useRedFlagsColumnPrefs } from '@/lib/useRedFlagsColumnPrefs';
import {
  renderRedFlagsBodyCell,
  renderRedFlagsHeaderCell,
  redFlagsBodyCellClass,
  redFlagsBodyCellProps,
  type RedFlagsHeaderCtx,
  type RedFlagsRowBundle,
} from './redFlagsTableRender';
import type { StitchKpi } from '@/components/StitchKpiStrip';
import { OpsViewToggle } from '@/components/OpsViewToggle';
import { useCompactOpsLayout } from '@/lib/compactOpsLayout';
import { useAlertUiTheme } from '@/lib/useAlertUiTheme';
import { ProRedFlagsView } from '@/features/pro/ProRedFlagsView';
import { RedFlagsCardList } from './RedFlagsCardList';
import type { RedFlagsColumnKey } from './redFlagsWorkbookColumns';
import { cycleColumnSort, type ColumnSortState } from '@/lib/tableColumnSort';
import { sortRankedRedFlags, type RedFlagsSortContext } from './redFlagsTableSort';
import styles from './RedFlagsBoard.module.css';

const RED_FLAGS_VIEW_KEY = 'alert_redflags_view';
type RedFlagsViewMode = 'cards' | 'table';

function initialRedFlagsView(compact: boolean): RedFlagsViewMode {
  if (typeof window === 'undefined') return 'table';
  const saved = localStorage.getItem(RED_FLAGS_VIEW_KEY);
  if (saved === 'cards' || saved === 'table') return saved;
  /* Pro/iPad compact: cards first for readability on touch. */
  return compact ? 'cards' : 'table';
}

type Snapshot = {
  generatedAt?: string;
  cacheGeneratedAt?: string | null;
  fromCache?: boolean;
  cacheStale?: boolean;
  rows?: RedAlertRow[];
  error?: string;
};

type RemoteCreditsTodayTotals = {
  date?: string | null;
  byMachineId?: Record<
    string,
    {
      credits_sent?: number;
      dispense_tests?: number;
      vends_resolved?: string;
      cleaning_windows?: unknown;
      timezone?: string;
    }
  >;
  error?: string;
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
  lastCleaningAt?: string | null;
};

type LiveDashboardSnapshotResponse = {
  machines?: LiveDashboardMachine[];
};

function vendonTxIsoFromEntry(entry?: { timestamp: number } | null): string {
  if (entry?.timestamp != null && Number(entry.timestamp) > 0) {
    return new Date(Number(entry.timestamp) * 1000).toISOString();
  }
  return '';
}

/** Prefer list fields (including empty []) so a stale singular lowProduct is not revived. */
function vendonExtremesLists(entry?: {
  topProduct?: { name?: string | null; count?: number | null } | null;
  lowProduct?: { name?: string | null; count?: number | null } | null;
  topProducts?: Array<{ name?: string | null; count?: number | null }> | null;
  lowProducts?: Array<{ name?: string | null; count?: number | null }> | null;
  distinctDrinksSold?: number | null;
  productMixCachedAt?: string | null;
} | null) {
  const topProducts = Array.isArray(entry?.topProducts)
    ? entry!.topProducts!
    : entry?.topProduct
      ? [entry.topProduct]
      : [];
  const lowProducts = Array.isArray(entry?.lowProducts)
    ? entry!.lowProducts!
    : entry?.lowProduct
      ? [entry.lowProduct]
      : [];
  return {
    topProducts,
    lowProducts,
    distinctDrinksSold: entry?.distinctDrinksSold,
    productMixCachedAt: entry?.productMixCachedAt,
  };
}

type DetailView = {
  payload: RedAlertDetailPayload;
  alertSummary: string;
  freq: FreqSplit;
  freqCtx: FreqColumnContext;
  compareMode: RedAlertCompareMode;
  trendHero: ReturnType<typeof trendHistoryComparisons>;
  incidentsMeta?: DailyIncidentsElapsedResponse;
  operatorName: string;
  strikeOperatorEmail?: string | null;
  machineId: string;
  attendanceSummary?: MachineAttendanceSummary;
  sales?: SalesElapsedRow;
  creditsSent?: number;
  dispenseTests?: number;
  vendsResolved?: string;
  cleaningLabel?: string;
  /** Vendon last-transactions fallback when snapshot has no ISO. */
  lastTxVendonIso?: string | null;
};

function DetailModal({ view, onClose }: { view: DetailView; onClose: () => void }) {
  const { payload } = view;
  const slackMapQ = useSlackUserMap();
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const slackContact = useMemo(() => {
    const env = getAlertRuntimeEnv();
    return {
      map: slackMapQ.data?.map ?? {},
      team: (slackMapQ.data?.teamId || env.SLACK_TEAM_ID || '').trim(),
    };
  }, [slackMapQ.data]);

  return (
    <div
      className={`${styles.backdrop} redFlagsDetailBackdrop`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="red-flags-detail-title"
      {...backdrop}
    >
      <div className={`${styles.modal} redFlagsDetailModal`} {...panel}>
        <div className={`${styles.modalHead} redFlagsDetailHead`}>
          <div>
            <p className={styles.detailEyebrow}>Machine detail</p>
            <h2 id="red-flags-detail-title" className={styles.modalTitle}>
              {payload.machineName || payload.machineId}
            </h2>
            <p className={styles.detailMachineId}>#{payload.machineId}</p>
          </div>
          <button type="button" className={styles.detailCloseBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={`${styles.detailBody} redFlagsDetailBody`}>
        <div className={styles.detailStatusRow}>
          <span className={styles.detailStatusPill}>{payload.statusLabel}</span>
          {payload.duringScheduledCleaningNow ? (
            <span className={styles.detailStatusPillMuted}>Cleaning window</span>
          ) : null}
        </div>

        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Why flagged</h3>
          <p className={styles.detailAlertLead}>{view.alertSummary || '—'}</p>
          {(payload.reasons || []).length > 1 ? (
            <ul className={styles.detailReasonList}>
              {(payload.reasons || []).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <div className={styles.detailMetricGrid}>
          <div className={styles.detailMetricCard}>
            <span className={styles.detailMetricLabel}>Last sale</span>
            <span className={styles.detailMetricVal}>
              {payload.lastTransactionAtUtc
                ? formatLastTxCompact(String(payload.lastTransactionAtUtc))
                : view.lastTxVendonIso
                  ? formatLastTxCompact(view.lastTxVendonIso)
                  : payload.minutesSinceLastTransaction != null
                    ? `${payload.minutesSinceLastTransaction} min ago`
                    : '—'}
            </span>
            {payload.lastTransactionEstimated ? (
              <span className={styles.detailMetricSub}>Estimated time</span>
            ) : view.lastTxVendonIso && !payload.lastTransactionAtUtc ? (
              <span className={styles.detailMetricSub}>From Vendon last transaction</span>
            ) : null}
          </div>
          <div className={styles.detailMetricCard}>
            <span className={styles.detailMetricLabel}>Sales today</span>
            <span className={styles.detailMetricVal}>
              {view.sales?.todayKwd != null ? formatKwd(view.sales.todayKwd) : '—'}
            </span>
            {view.sales?.yesterdaySameElapsedKwd != null ? (
              <span className={styles.detailMetricSub}>
                vs {formatKwd(view.sales.yesterdaySameElapsedKwd)} yesterday
                {view.sales.trendPct != null ? ` (${formatSalesTrendPct(view.sales.trendPct)})` : ''}
              </span>
            ) : null}
          </div>
          <div className={styles.detailMetricCard}>
            <span className={styles.detailMetricLabel}>Credits sent</span>
            <span className={styles.detailMetricVal}>
              {Number.isFinite(view.creditsSent) ? String(view.creditsSent) : '—'}
            </span>
            <span className={styles.detailMetricSub}>
              Tests: {Number.isFinite(view.dispenseTests) ? view.dispenseTests : '—'}
            </span>
          </div>
          <div className={styles.detailMetricCard}>
            <span className={styles.detailMetricLabel}>Vends resolved</span>
            <span className={styles.detailMetricVal}>{view.vendsResolved || '—'}</span>
            {view.cleaningLabel ? <span className={styles.detailMetricSub}>{view.cleaningLabel}</span> : null}
          </div>
        </div>

        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Contact operator</h3>
          <OperatorContactSection
            layout="modal"
            operatorName={view.operatorName}
            strikeOperatorEmail={view.strikeOperatorEmail}
            machineId={view.machineId}
            machineLabel={payload.machineName || payload.machineId}
            slackEmailMap={slackContact.map}
            slackTeamId={slackContact.team}
            attendanceSummary={view.attendanceSummary}
          />
        </section>

        <section className={`${styles.detailSection} trendBreakdownInDetail`}>
          <TrendBreakdownPanel
            compareMode={view.compareMode}
            scoreText={view.freqCtx.scoreText}
            trendText={view.freqCtx.trendText}
            gapDisplay={view.freqCtx.gapDisplay}
            scoreExplain={view.freqCtx.scoreExplain}
            trendExplain={view.freqCtx.trendExplain}
            gapExplain={view.freqCtx.gapExplain}
            heroLabel={view.trendHero.heroLabel}
            heroValue={view.trendHero.heroValue}
            heroDate={view.trendHero.heroDate}
            heroSub={view.trendHero.heroSub}
            comparisons={view.trendHero.comparisons}
            asOfLocal={view.incidentsMeta?.asOfLocal}
            comparisonNote={view.incidentsMeta?.comparisonNote}
          />
        </section>

        {payload.goCheckUrl ? (
          <div className={styles.detailActions}>
            <a href={payload.goCheckUrl} className={styles.btnPrimary}>
              Go check
            </a>
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}

const RF_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function redFlagsOperatingDaysLabel(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const o = raw as Record<string, unknown>;
  const preset = String(o.preset || '').trim();
  if (preset === 'all_week') return 'All week';
  if (preset === 'weekends_off') return 'Weekends off';
  if (preset === 'custom' && Array.isArray(o.days)) {
    const days = (o.days as unknown[])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)
      .map((n) => RF_DAY_LABELS[n] ?? String(n));
    return days.length ? `Days: ${days.join(', ')}` : 'Days: custom';
  }
  return '';
}

export function RedFlagsPage({
  variant = 'classic',
}: {
  /** classic = Stitch panel; manus = Manus chrome + same Classic fields/APIs */
  variant?: 'classic' | 'manus';
} = {}) {
  const manus = variant === 'manus';
  const location = useLocation();
  const [compare, setCompare] = useState<CompareSelection>(() => initialCompareSelection());
  const compareMode = useMemo(() => comparePresetToRedAlertMode(compare.preset), [compare.preset]);
  const setComparePersist = useCallback((next: CompareSelection) => {
    setCompare(next);
    persistCompareSelection(next);
  }, []);

  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [ranked, setRanked] = useState<RankedRedAlertRow[]>([]);
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [trendDetail, setTrendDetail] = useState<{
    machineName: string;
    machineId: string;
    row: IncidentsElapsedRow;
    snapTrend: {
      happensWeek?: number | null;
      happenedLastWeekAlignedSlice?: number | null;
      happenedLastWeek?: number | null;
      happenedPctVsPriorWeek?: number | null;
      happensToday?: number | null;
      happenedSameDayLastWeek?: number | null;
      happenedPctVsSameDayLastWeek?: number | null;
      happenedYesterdaySameElapsed?: number | null;
      happenedPctVsYesterdaySameElapsed?: number | null;
    };
    scoreText: string;
    trendText: string;
    gapDisplay: string;
    scoreExplain: string;
    trendExplain: string;
    gapExplain: string;
    operatorName: string;
    strikeOperatorEmail?: string | null;
    attendanceSummary?: MachineAttendanceSummary;
  } | null>(null);
  const [salesDetail, setSalesDetail] = useState<{
    machineName: string;
    machineId: string;
    row: SalesElapsedRow;
    operatorName: string;
    strikeOperatorEmail?: string | null;
    attendanceSummary?: MachineAttendanceSummary;
  } | null>(null);
  const [downtimeDetail, setDowntimeDetail] = useState<{
    machineName: string;
    machineId: string;
    todaySec?: number | null;
    periodSec?: number | null;
    trendPct?: number | null;
  } | null>(null);
  const [targetDetail, setTargetDetail] = useState<{
    machineName: string;
    machineId: string;
    todayKwd?: number;
    yesterdayKwd?: number;
    dailyTargetKd?: number | null;
    locationOwnerName?: string | null;
  } | null>(null);
  const [sxDetail, setSxDetail] = useState<{
    machineName: string;
    machineId: string;
    sxRow?: SxAccelerationRow | null;
  } | null>(null);
  const [drinksDetail, setDrinksDetail] = useState<{
    machineName: string;
    machineId: string;
  } | null>(null);
  const [goCheckDetail, setGoCheckDetail] = useState<{
    machineId: string;
    machineName: string;
    alertType: string;
  } | null>(null);
  const salesComparisonNote = useMemo(() => presetLabels(compare.preset).caption, [compare.preset]);
  const [fleetSearch, setFleetSearch] = useState('');
  const [riskSort, setRiskSort] = useState(false);
  const [salesSort, setSalesSort] = useState(false);
  const [hideInactive, setHideInactive] = useState(false);
  const [columnSort, setColumnSort] = useState<ColumnSortState<RedFlagsColumnKey>>({
    column: null,
    dir: null,
  });
  const [notifyPerm, setNotifyPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  );
  const [ticker, setTicker] = useState<{ newN: number; updN: number; total: number } | null>(null);
  const prevReasonRef = useRef<Record<string, string>>({});
  /** Safari/iPad retargets `click` to `<tr>`; remember pointer target for synthetic activation. */
  const rowTapTargetRef = useRef<HTMLElement | null>(null);
  const hasLoadedRef = useRef(false);
  const [clock, setClock] = useState(() => new Date());
  const compactOps = useCompactOpsLayout();
  const [redView, setRedView] = useState<RedFlagsViewMode>(() => initialRedFlagsView(compactOps));
  const setRedViewPersist = useCallback((mode: RedFlagsViewMode) => {
    setRedView(mode);
    try {
      localStorage.setItem(RED_FLAGS_VIEW_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);
  const { user } = useAuth();
  const { stored: columnStored, setColumns: handleColumnsChange, syncState: columnSyncState } =
    useRedFlagsColumnPrefs(user?.email);
  const visibleColumns = useMemo(() => visibleRedFlagsColumns(columnStored), [columnStored]);
  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const q = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    refetchInterval: 60_000,
  });

  const slackMapQ = useSlackUserMap();
  const slackContact = useMemo(() => {
    const env = getAlertRuntimeEnv();
    return {
      map: slackMapQ.data?.map ?? {},
      team: (slackMapQ.data?.teamId || env.SLACK_TEAM_ID || '').trim(),
    };
  }, [slackMapQ.data]);

  const creditsMachineIdsKey = useMemo(() => {
    const rawRows = (q.data?.rows ?? []) as RedAlertRow[];
    const rows = filterSnapshotRows(rawRows);
    const ids = rows.map((r) => String(getMachineIdRaw(r) || '').trim()).filter(Boolean);
    ids.sort();
    return ids.join(',');
  }, [q.data]);

  const creditsQ = useQuery({
    queryKey: ['alert-remote-credits-today-totals', creditsMachineIdsKey],
    queryFn: async () => {
      const base = '/api/alert/remote-credits/today-totals';
      const ids = creditsMachineIdsKey.split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) {
        return apiGet<RemoteCreditsTodayTotals>(base);
      }
      const chunkSize = 12;
      const merged: NonNullable<RemoteCreditsTodayTotals['byMachineId']> = {};
      let date: string | null | undefined;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize).join(',');
        try {
          const part = await apiGet<RemoteCreditsTodayTotals>(
            `${base}?machines=${encodeURIComponent(chunk)}`,
          );
          date = part.date ?? date;
          Object.assign(merged, part.byMachineId ?? {});
        } catch (err) {
          console.warn('remote-credits chunk failed', chunk.slice(0, 40), err);
        }
        if (i + chunkSize < ids.length) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      return { date, byMachineId: merged };
    },
    enabled: q.isFetched,
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });

  const operatorActivityQ = useQuery({
    queryKey: ['alert-operator-activity', creditsMachineIdsKey, 14],
    queryFn: async () => {
      const base = '/api/alert/operator-activity';
      const ids = creditsMachineIdsKey.split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) {
        return apiGet<{
          byMachineId?: Record<string, import('@/components/OperatorActivityCell').OperatorActivityTimes>;
        }>(`${base}?days=14`);
      }
      return apiGet<{
        byMachineId?: Record<string, import('@/components/OperatorActivityCell').OperatorActivityTimes>;
      }>(`${base}?machines=${encodeURIComponent(ids.join(','))}&days=14`);
    },
    enabled: q.isFetched && Boolean(creditsMachineIdsKey),
    refetchInterval: 3 * 60_000,
    staleTime: 90_000,
  });

  const dailySalesQ = useQuery({
    queryKey: ['alert-daily-sales-elapsed', compare.preset],
    queryFn: () => apiGet<DailySalesElapsedResponse>('/api/alert/overall/daily-sales-elapsed'),
    enabled: q.isFetched,
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnMount: 'always',
  });

  const vendonLastTxQ = useQuery({
    queryKey: ['alert-overall-vendon-last-transactions'],
    queryFn: () => apiGet<VendonLastTransactionsResponse>('/api/alert/overall/last-transactions'),
    enabled: q.isFetched,
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
  });

  const profilesQ = useQuery({
    queryKey: ['alert-overall-admin-profiles'],
    queryFn: () =>
      apiGet<{
        rows?: {
          machine_id?: string;
          machine_name?: string;
          location_owner?: string | null;
          location_hours?: string | null;
          timezone?: string | null;
          operating_days?: unknown;
          is_active?: boolean;
          inactiveToday?: boolean;
          inactiveLabel?: string | null;
        }[];
      }>('/api/alert/overall/admin-profiles'),
    enabled: q.isFetched,
    staleTime: 5 * 60_000,
    refetchInterval: 60_000,
  });

  const areaOwnerMapQ = useQuery({
    queryKey: ['alert-area-owner-map'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { name?: string; vendonUserId?: string }> }>(
        '/api/alert/area-owner-map',
      ),
    enabled: q.isFetched,
    staleTime: 2 * 60_000,
    refetchInterval: 60_000,
  });

  const locationOwnerLookup = useMemo(() => {
    const byId = new Map<string, string>();
    const byName = new Map<string, string>();
    const inactiveById = new Map<string, { inactive: boolean; label: string }>();
    const hoursById = new Map<
      string,
      { locHours: string; operatingDaysLabel: string; timezoneLabel: string }
    >();
    const rows = profilesQ.data?.rows;
    if (!Array.isArray(rows)) return { byId, byName, inactiveById, hoursById };
    for (const r of rows) {
      const id = String(r.machine_id ?? '').trim();
      const owner = String(r.location_owner ?? '').trim();
      const name = String(r.machine_name ?? '').trim().toLowerCase();
      if (id && owner) byId.set(id, owner);
      if (name && owner) byName.set(name, owner);
      if (id) {
        const inactive = r.inactiveToday === true || r.is_active === false;
        inactiveById.set(id, {
          inactive,
          label: String(r.inactiveLabel || (r.is_active === false ? 'Inactive' : 'Inactive today')).trim() || 'Inactive',
        });
        hoursById.set(id, {
          locHours: String(r.location_hours ?? '').trim(),
          operatingDaysLabel: redFlagsOperatingDaysLabel(r.operating_days),
          timezoneLabel: String(r.timezone ?? '').trim(),
        });
      }
    }
    return { byId, byName, inactiveById, hoursById };
  }, [profilesQ.data?.rows]);

  function resolveAreaOwnerPerson(machId: string): string | null {
    const entry = areaOwnerMapQ.data?.byMachineId?.[machId];
    const name = String(entry?.name ?? '').trim();
    return name || null;
  }

  function resolveLocationTagForRow(machId: string, machineName: string): string | null {
    const fromId = locationOwnerLookup.byId.get(machId);
    if (fromId) return fromId;
    const key = String(machineName || '').trim().toLowerCase();
    if (key) {
      const fromName = locationOwnerLookup.byName.get(key);
      if (fromName) return fromName;
    }
    return null;
  }

  /** Owner box: Area owners person first, then location tag (KU/MOH). */
  function resolveLocationOwnerForRow(machId: string, machineName: string): string | null {
    return resolveAreaOwnerPerson(machId) || resolveLocationTagForRow(machId, machineName);
  }

  const vendonSummaryQ = useQuery({
    queryKey: [
      'alert-vendon-sales-summary',
      compare.preset,
      compare.a.start,
      compare.a.end,
      compare.b.start,
      compare.b.end,
    ],
    queryFn: () =>
      apiGet<{
        labelA?: string | null;
        labelB?: string | null;
        dateAStart?: string | null;
        dateAEnd?: string | null;
        byMachineId?: Record<
          string,
          {
            aSalesKwd?: number | null;
            bSalesKwd?: number | null;
            trendPct?: number | null;
            topProduct?: { name?: string | null; count?: number | null } | null;
            lowProduct?: { name?: string | null; count?: number | null } | null;
            topProducts?: Array<{ name?: string | null; count?: number | null }> | null;
            lowProducts?: Array<{ name?: string | null; count?: number | null }> | null;
            distinctDrinksSold?: number | null;
            productMixCachedAt?: string | null;
          }
        >;
      }>(`/api/alert/overall/vendon-sales-summary?${presetApiQueryString(compare.preset, compare)}`),
    enabled: q.isFetched,
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });

  const sxQ = useQuery({
    queryKey: [
      'alert-sales-acceleration',
      compare.preset,
      compare.a.start,
      compare.a.end,
      compare.b.start,
      compare.b.end,
    ],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<string, import('@/components/SxAccelerationCell').SxAccelerationRow>;
      }>(`/api/alert/overall/sales-acceleration?${presetApiQueryString(compare.preset, compare)}`),
    enabled: q.isFetched,
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });

  const downtimeQ = useQuery({
    queryKey: [
      'alert-downtime-summary',
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
    enabled: q.isFetched,
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
  });

  const liveSnapQ = useQuery({
    queryKey: ['live-dashboard-snapshot'],
    queryFn: () => apiGet<LiveDashboardSnapshotResponse>('/api/live-dashboard/snapshot'),
    enabled: q.isFetched,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

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

  const liveCleaningByMachineId = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const [id, row] of liveByMachineId) {
      out[id] = row.lastCleaningAt ?? null;
    }
    return out;
  }, [liveByMachineId]);

  const mtdVendonQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd'],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<string, { aSalesKwd?: number | null }>;
      }>('/api/alert/overall/vendon-sales-summary?preset=mtd_vs_mtd'),
    enabled: q.isFetched,
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });

  const mtdYoyVendonQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd-yoy'],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<
          string,
          { aSalesKwd?: number | null; bSalesKwd?: number | null; trendPct?: number | null }
        >;
      }>('/api/alert/overall/vendon-sales-summary?preset=mtd_vs_yoy'),
    enabled: q.isFetched,
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });

  const qaSummaryQ = useQuery({
    queryKey: ['alert-qa-summary'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    enabled: q.isFetched,
    staleTime: 60_000,
    refetchInterval: (query) => {
      const d = query.state.data as QaSummaryResponse | undefined;
      if (d?.partial || d?.warning) return 20_000;
      if (!d?.latestByMachine || !Object.keys(d.latestByMachine).length) return 30_000;
      return 5 * 60_000;
    },
  });

  const qaFindingsQ = useQuery({
    queryKey: ['alert-qa-findings'],
    queryFn: () => apiGet<QaFindingsResponse>('/api/alert/qa/findings'),
    enabled: q.isFetched,
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const dailyIncidentsQ = useQuery({
    queryKey: ['alert-daily-incidents-elapsed', compare.preset, creditsMachineIdsKey],
    queryFn: async () => {
      const base = '/api/alert/red-flags/daily-incidents-elapsed';
      const ids = creditsMachineIdsKey.split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) {
        return apiGet<DailyIncidentsElapsedResponse>(base);
      }
      const chunkSize = 12;
      const merged: NonNullable<DailyIncidentsElapsedResponse['byMachineId']> = {};
      let asOfLocal: string | undefined;
      let today: string | undefined;
      let yesterday: string | undefined;
      let comparisonNote: string | undefined;
      let timezone: string | undefined;
      let historyDays: number | undefined;
      let historyDates: string[] | undefined;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize).join(',');
        try {
          const part = await apiGet<DailyIncidentsElapsedResponse>(
            `${base}?machines=${encodeURIComponent(chunk)}`,
          );
          asOfLocal = part.asOfLocal ?? asOfLocal;
          today = part.today ?? today;
          yesterday = part.yesterday ?? yesterday;
          comparisonNote = part.comparisonNote ?? comparisonNote;
          timezone = part.timezone ?? timezone;
          historyDays = part.historyDays ?? historyDays;
          historyDates = part.historyDates ?? historyDates;
          Object.assign(merged, part.byMachineId ?? {});
        } catch (err) {
          console.warn('daily-incidents-elapsed chunk failed', chunk.slice(0, 40), err);
        }
        if (i + chunkSize < ids.length) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      return {
        asOfLocal,
        today,
        yesterday,
        comparisonNote,
        timezone,
        historyDays,
        historyDates,
        byMachineId: merged,
      };
    },
    enabled: q.isFetched,
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });

  const workflowAttendanceQ = useQuery({
    queryKey: ['leet-workflow-attendance-map', creditsMachineIdsKey],
    queryFn: () =>
      fetchMachineAttendanceMapBatched(
        creditsMachineIdsKey.split(',').map((s) => s.trim()).filter(Boolean),
      ),
    enabled: q.isFetched && Boolean(creditsMachineIdsKey),
    staleTime: 2 * 60_000,
    refetchInterval: 3 * 60_000,
  });

  const workflowCleaningQ = useQuery({
    queryKey: ['leet-workflow-cleaning-map', creditsMachineIdsKey],
    queryFn: () =>
      fetchCleaningWorkflowMapBatched(
        creditsMachineIdsKey.split(',').map((s) => s.trim()).filter(Boolean),
      ),
    enabled: q.isFetched && Boolean(creditsMachineIdsKey),
    staleTime: 2 * 60_000,
    refetchInterval: 3 * 60_000,
  });

  const snapTime = q.data?.generatedAt || q.data?.cacheGeneratedAt || null;
  const creditsByMachineId = creditsQ.data?.byMachineId ?? {};

  useLayoutEffect(() => {
    if (!q.data) return;
    const rawRows = (q.data.rows ?? []) as RedAlertRow[];
    const rows = filterSnapshotRows(rawRows);
    let prevMap = prevReasonRef.current;
    if (!hasLoadedRef.current && rows.length) {
      prevMap = baselineReasonMap(rows);
    }
    hasLoadedRef.current = true;

    if (snapTime) {
      try {
        setGeneratedAt(new Date(snapTime).toLocaleString());
      } catch {
        setGeneratedAt(snapTime);
      }
    } else {
      setGeneratedAt(null);
    }

    if (!rows.length) {
      prevReasonRef.current = {};
      setRanked([]);
      setTicker({ newN: 0, updN: 0, total: 0 });
      return;
    }

    const list = rankRows(rows, prevMap, compareMode, dailyIncidentsQ.data?.byMachineId);
    const nextPrev: Record<string, string> = {};
    let newN = 0;
    let updN = 0;
    for (const d of list) {
      const machId = String(getMachineIdRaw(d.row) || '');
      nextPrev[machId] = reasonKey(d.row);
      if (d.isNew) newN += 1;
      else if (d.isChanged) updN += 1;
    }
    prevReasonRef.current = nextPrev;
    setRanked(list);
    setTicker({ newN, updN, total: rows.length });
  }, [q.data, q.dataUpdatedAt, compareMode, snapTime, dailyIncidentsQ.data]);

  const buildSnapTrend = useCallback((row: RedAlertRow) => ({
    happensWeek: row.happensWeek,
    happenedLastWeekAlignedSlice: row.happenedLastWeekAlignedSlice,
    happenedLastWeek: row.happenedLastWeek,
    happenedPctVsPriorWeek: row.happenedPctVsPriorWeek,
    happensToday: row.happensToday ?? row.frequency?.totalCriteriaHitsToday,
    happenedSameDayLastWeek: row.happenedSameDayLastWeek,
    happenedPctVsSameDayLastWeek: row.happenedPctVsSameDayLastWeek,
    happenedYesterdaySameElapsed: row.happenedYesterdaySameElapsed,
    happenedPctVsYesterdaySameElapsed: row.happenedPctVsYesterdaySameElapsed,
    happenedDayBeforeSameElapsed: row.happenedDayBeforeSameElapsed,
    happenedPctVsDayBefore: row.happenedPctVsDayBefore,
  }), []);

  const openDetail = useCallback(
    (d: RankedRedAlertRow) => {
      const row = d.row;
      const machId = String(getMachineIdRaw(row) || '');
      const statusLabel = d.isNew ? 'New alert' : d.isChanged ? 'Updated' : 'Ongoing';
      const cred = machId ? creditsByMachineId[machId] : undefined;
      const cleanIso = pickLastCleaningIso(row, liveByMachineId.get(machId)?.lastCleaningAt);
      const cleanWins = cleaningWindowsFromAdmin(cred?.cleaning_windows);
      const cleanStatus = cleanIso
        ? lastCleanedStatus({ lastCleaningIso: cleanIso, cleaningWindows: cleanWins })
        : null;
      const alertSummary =
        row.reasons && row.reasons.length
          ? String(row.reasons[row.reasons.length - 1] ?? '').replace(/\s+/g, ' ').trim()
          : 'No alert reason in snapshot';
      const incidentsRow = resolveIncidentsRow(
        row,
        incidentsElapsedForMachine(dailyIncidentsQ.data, machId, dailyIncidentsQ.isSuccess),
      );
      const freqCtx = buildFreqColumnContext(row, compareMode, incidentsRow);
      const snapTrend = buildSnapTrend(row);
      const trendHero = trendHistoryComparisons(
        incidentsRow,
        dailyIncidentsQ.data,
        compareMode,
        snapTrend,
      );
      const salesRow = salesElapsedForMachine(dailySalesQ.data, machId, dailySalesQ.isSuccess);
      const vendonSales = vendonSummaryQ.data?.byMachineId?.[machId];
      const salesPair = salesPairForPreset(
        compare.preset,
        salesRow,
        compare,
        vendonSales,
        {
          primary: vendonSummaryQ.data?.labelA?.trim() || undefined,
          baseline: vendonSummaryQ.data?.labelB?.trim() || undefined,
        },
      );
      const salesForDetail: SalesElapsedRow | undefined =
        salesRow ??
        (salesPair.primary != null && Number.isFinite(salesPair.primary)
          ? {
              todayKwd: salesPair.primary,
              yesterdaySameElapsedKwd:
                salesPair.baseline != null && Number.isFinite(salesPair.baseline)
                  ? salesPair.baseline
                  : undefined,
              trendPct: salesPair.trendPct ?? null,
              dailyElapsed: [],
            }
          : undefined);
      setDetail({
        payload: buildDetailPayload(row, machId, statusLabel, compareMode, snapTime ?? null),
        alertSummary,
        freq: freqSplit(row, compareMode, incidentsRow),
        freqCtx,
        compareMode,
        trendHero,
        incidentsMeta: dailyIncidentsQ.data,
        machineId: machId,
        attendanceSummary: workflowAttendanceQ.data?.byMachineId?.[machId],
        operatorName: getOperatorDisplayName(row, workflowAttendanceQ.data?.byMachineId?.[machId]),
        strikeOperatorEmail: resolveOperatorStrikeEmail(row, workflowAttendanceQ.data?.byMachineId?.[machId]),
        sales: salesForDetail,
        creditsSent: cred?.credits_sent != null ? Number(cred.credits_sent) : undefined,
        dispenseTests: cred?.dispense_tests != null ? Number(cred.dispense_tests) : undefined,
        vendsResolved: cred?.vends_resolved != null ? String(cred.vends_resolved) : undefined,
        cleaningLabel: cleanStatus?.label,
        lastTxVendonIso: vendonTxIsoFromEntry(vendonLastTxQ.data?.byMachineId?.[machId]) || null,
      });
    },
    [compare, compareMode, snapTime, creditsByMachineId, liveByMachineId, dailySalesQ.data, dailySalesQ.isSuccess, dailyIncidentsQ.data, dailyIncidentsQ.isSuccess, buildSnapTrend, vendonLastTxQ.data?.byMachineId, vendonSummaryQ.data, workflowAttendanceQ.data?.byMachineId],
  );

  const openTrendHistory = useCallback(
    (row: RedAlertRow, machId: string, incidentsRow?: IncidentsElapsedRow) => {
      const resolved = resolveIncidentsRow(
        row,
        incidentsRow ??
          incidentsElapsedForMachine(dailyIncidentsQ.data, machId, dailyIncidentsQ.isSuccess),
      );
      const snapTrend = buildSnapTrend(row);
      const freqCtx = buildFreqColumnContext(row, compareMode, resolved);
      setTrendDetail({
        machineName: String(row.machineName || machId),
        machineId: machId,
        row: resolved ?? { todayHits: snapTrend.happensToday ?? undefined },
        snapTrend,
        scoreText: freqCtx.scoreText,
        trendText: freqCtx.trendText,
        gapDisplay: freqCtx.gapDisplay,
        scoreExplain: freqCtx.scoreExplain,
        trendExplain: freqCtx.trendExplain,
        gapExplain: freqCtx.gapExplain,
        attendanceSummary: workflowAttendanceQ.data?.byMachineId?.[machId],
        operatorName: getOperatorDisplayName(row, workflowAttendanceQ.data?.byMachineId?.[machId]),
        strikeOperatorEmail: resolveOperatorStrikeEmail(row, workflowAttendanceQ.data?.byMachineId?.[machId]),
      });
    },
    [buildSnapTrend, compareMode, dailyIncidentsQ.data, dailyIncidentsQ.isSuccess, workflowAttendanceQ.data?.byMachineId],
  );

  const openSalesHistory = useCallback((row: RedAlertRow, machId: string, salesRow: SalesElapsedRow) => {
    setSalesDetail({
      machineName: String(row.machineName || machId),
      machineId: machId,
      row: salesRow,
      attendanceSummary: workflowAttendanceQ.data?.byMachineId?.[machId],
      operatorName: getOperatorDisplayName(row, workflowAttendanceQ.data?.byMachineId?.[machId]),
      strikeOperatorEmail: resolveOperatorStrikeEmail(row, workflowAttendanceQ.data?.byMachineId?.[machId]),
    });
  }, [workflowAttendanceQ.data?.byMachineId]);

  const snapshotRows = useMemo(() => filterSnapshotRows((q.data?.rows ?? []) as RedAlertRow[]), [q.data?.rows]);
  const cleaningOverdueCount = useMemo(
    () => snapshotRows.filter((r) => r.cleaningOverdue15h).length,
    [snapshotRows],
  );
  useCleaningOverdueAlerts(snapshotRows, q.isFetched);

  const redFlagsSortCtx = useMemo(
    (): RedFlagsSortContext => ({
      compareMode,
      compare,
      dailySales: dailySalesQ.data,
      dailySalesReady: dailySalesQ.isSuccess,
      mtdByMachine: mtdVendonQ.data?.byMachineId,
      mtdReady: mtdVendonQ.isSuccess && Boolean(mtdVendonQ.data?.byMachineId),
      mtdYoyByMachine: mtdYoyVendonQ.data?.byMachineId,
      mtdYoyReady: mtdYoyVendonQ.isSuccess && Boolean(mtdYoyVendonQ.data?.byMachineId),
      vendonByMachine: vendonSummaryQ.data?.byMachineId,
      creditsByMachine: creditsByMachineId,
      incidentsByMachine: dailyIncidentsQ.data?.byMachineId,
      qaSummary: qaSummaryQ.data,
      snapshotGeneratedAt: q.data?.cacheGeneratedAt ?? q.data?.generatedAt ?? null,
      lastTxByMachine: vendonLastTxQ.data?.byMachineId,
      sxByMachine: sxQ.data?.byMachineId,
      sxReady: sxQ.isSuccess && Boolean(sxQ.data?.byMachineId),
      downtimeByMachine: downtimeQ.data?.byMachineId,
      operatorActivityByMachine: operatorActivityQ.data?.byMachineId,
    }),
    [
      compareMode,
      compare,
      dailySalesQ.data,
      dailySalesQ.isSuccess,
      mtdVendonQ.data,
      mtdVendonQ.isSuccess,
      mtdYoyVendonQ.data,
      mtdYoyVendonQ.isSuccess,
      vendonSummaryQ.data?.byMachineId,
      creditsByMachineId,
      dailyIncidentsQ.data?.byMachineId,
      qaSummaryQ.data,
      q.data?.cacheGeneratedAt,
      q.data?.generatedAt,
      vendonLastTxQ.data?.byMachineId,
      sxQ.data?.byMachineId,
      sxQ.isSuccess,
      downtimeQ.data?.byMachineId,
      operatorActivityQ.data?.byMachineId,
    ],
  );

  const onSortColumn = useCallback((key: RedFlagsColumnKey) => {
    setColumnSort((prev) => cycleColumnSort(prev, key));
  }, []);

  const displayRanked = useMemo(() => {
    const sorted = sortRankedRedFlags(ranked, columnSort, redFlagsSortCtx);
    let filtered = sorted.filter((d) =>
      machineMatchesSearch(fleetSearch, {
        id: getMachineIdRaw(d.row),
        name: d.row.machineName,
      }),
    );
    if (hideInactive) {
      filtered = filtered.filter((d) => {
        const id = String(getMachineIdRaw(d.row) || '');
        return locationOwnerLookup.inactiveById.get(id)?.inactive !== true;
      });
    }
    if (salesSort) {
      const vendonLabels = {
        primary: vendonSummaryQ.data?.labelA?.trim() || undefined,
        baseline: vendonSummaryQ.data?.labelB?.trim() || undefined,
      };
      return filtered.slice().sort((a, b) => {
        const idA = String(getMachineIdRaw(a.row) || '');
        const idB = String(getMachineIdRaw(b.row) || '');
        const pairA = salesPairForPreset(
          compare.preset,
          salesElapsedForMachine(dailySalesQ.data, idA, dailySalesQ.isSuccess),
          compare,
          vendonSummaryQ.data?.byMachineId?.[idA],
          vendonLabels,
        );
        const pairB = salesPairForPreset(
          compare.preset,
          salesElapsedForMachine(dailySalesQ.data, idB, dailySalesQ.isSuccess),
          compare,
          vendonSummaryQ.data?.byMachineId?.[idB],
          vendonLabels,
        );
        const sa = pairA.primary != null && Number.isFinite(pairA.primary) ? Number(pairA.primary) : -1;
        const sb = pairB.primary != null && Number.isFinite(pairB.primary) ? Number(pairB.primary) : -1;
        return sb - sa;
      });
    }
    if (!riskSort) return filtered;
    const nowSec = Math.floor(Date.now() / 1000);
    return filtered.slice().sort((a, b) => {
      const idA = String(getMachineIdRaw(a.row) || '');
      const idB = String(getMachineIdRaw(b.row) || '');
      const txA = vendonLastTxQ.data?.byMachineId?.[idA]?.timestamp;
      const txB = vendonLastTxQ.data?.byMachineId?.[idB]?.timestamp;
      const scoreA = fleetRiskScore({
        downtimeTodaySec: downtimeQ.data?.byMachineId?.[idA]?.todaySec,
        lastTxAgeMin:
          lastTxAgeMinutes(txA != null ? Number(txA) : null, nowSec) ??
          (a.row.minutesSinceLastTransaction != null ? Number(a.row.minutesSinceLastTransaction) : null),
        cleaningOverdue15h: Boolean(a.row.cleaningOverdue15h),
        reasonCount: Array.isArray(a.row.reasons) ? a.row.reasons.length : 0,
        inactiveToday: Boolean((a.row as { inactiveToday?: boolean }).inactiveToday),
      });
      const scoreB = fleetRiskScore({
        downtimeTodaySec: downtimeQ.data?.byMachineId?.[idB]?.todaySec,
        lastTxAgeMin:
          lastTxAgeMinutes(txB != null ? Number(txB) : null, nowSec) ??
          (b.row.minutesSinceLastTransaction != null ? Number(b.row.minutesSinceLastTransaction) : null),
        cleaningOverdue15h: Boolean(b.row.cleaningOverdue15h),
        reasonCount: Array.isArray(b.row.reasons) ? b.row.reasons.length : 0,
        inactiveToday: Boolean((b.row as { inactiveToday?: boolean }).inactiveToday),
      });
      return scoreB - scoreA;
    });
  }, [
    ranked,
    columnSort,
    redFlagsSortCtx,
    fleetSearch,
    hideInactive,
    locationOwnerLookup.inactiveById,
    salesSort,
    riskSort,
    compare,
    dailySalesQ.data,
    dailySalesQ.isSuccess,
    vendonSummaryQ.data?.byMachineId,
    vendonSummaryQ.data?.labelA,
    vendonSummaryQ.data?.labelB,
    vendonLastTxQ.data?.byMachineId,
    downtimeQ.data?.byMachineId,
  ]);

  const freqHeading = useMemo(
    () => freqHeadingForComparePreset(compare.preset, compareMode),
    [compare.preset, compareMode],
  );

  const vendonSalesLabels = useMemo(
    () => ({
      primary: vendonSummaryQ.data?.labelA?.trim() || undefined,
      baseline: vendonSummaryQ.data?.labelB?.trim() || undefined,
    }),
    [vendonSummaryQ.data?.labelA, vendonSummaryQ.data?.labelB],
  );

  const fleetRevenueTotals = useMemo(() => {
    const ids = displayRanked.map((d) => String(getMachineIdRaw(d.row) || '')).filter(Boolean);
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
    displayRanked,
    compare,
    dailySalesQ.data,
    dailySalesQ.isSuccess,
    vendonSummaryQ.data?.byMachineId,
    vendonSummaryQ.data?.labelA,
    vendonSummaryQ.data?.labelB,
  ]);

  const fleetYesterdayOverall = useMemo(() => {
    if (compare.preset !== 'today_vs_yesterday') return null;
    const ids = displayRanked.map((d) => String(getMachineIdRaw(d.row) || '')).filter(Boolean);
    const kwd = fleetYesterdayFullDayKwd(dailySalesQ.data, ids, dailySalesQ.data?.byMachineId);
    const dayBefore = fleetDayBeforeFullDayKwd(dailySalesQ.data, ids, dailySalesQ.data?.byMachineId);
    return {
      kwd,
      dayBeforeKwd: dayBefore,
      trendVsDayBeforePct: resolveSalesTrendPct(null, kwd, dayBefore),
    };
  }, [compare, displayRanked, dailySalesQ.data]);

  const headerCtx = useMemo(
    (): RedFlagsHeaderCtx => ({
      freqHeading,
      sort: columnSort,
      onSortColumn,
    }),
    [freqHeading, columnSort, onSortColumn],
  );

  const tableViewActive = ranked.length > 0 && (!compactOps || redView === 'table');

  const emptyClear = q.isSuccess && ranked.length === 0;

  const redKpis = useMemo((): StitchKpi[] => {
    const total = ticker?.total ?? 0;
    let snapVal = '…';
    if (generatedAt && snapTime) {
      try {
        snapVal = new Date(snapTime).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
      } catch {
        snapVal = 'Live';
      }
    } else if (q.isFetched) {
      snapVal = '—';
    }
    return [
      {
        label: 'Flagged',
        value: String(total),
        sub: total === 0 ? 'all clear' : 'machines',
        tone: total > 0 ? 'warn' : 'good',
      },
      {
        label: 'New',
        value: String(ticker?.newN ?? 0),
        sub: 'this refresh',
        tone: (ticker?.newN ?? 0) > 0 ? 'warn' : 'default',
      },
      {
        label: 'Updated',
        value: String(ticker?.updN ?? 0),
        sub: 'reason change',
      },
      {
        label: 'Snapshot',
        value: snapVal,
        sub: generatedAt ? 'Kuwait local' : 'loading',
      },
    ];
  }, [ticker, generatedAt, snapTime, q.isFetched]);

  const uiTheme = useAlertUiTheme();
  // Alert v2 (/v2/*) uses Manus chrome + classic ops tables — never Pro board layout
  const onV2 = location.pathname.startsWith('/v2');

  if (uiTheme === 'pro' && !onV2) {
    return (
      <>
        <ProRedFlagsView
          ranked={displayRanked}
          kpis={redKpis}
          compare={compare}
          onCompareChange={setComparePersist}
          compareMode={compareMode}
          salesNote={salesComparisonNote}
          asOfLocal={dailySalesQ.data?.asOfLocal}
          generatedAt={generatedAt}
          fetching={q.isFetching}
          loading={!q.isFetched && !q.isError}
          error={q.isError ? ((q.error as Error)?.message ?? 'Request failed') : null}
          emptyClear={emptyClear}
          cleaningOverdueCount={cleaningOverdueCount}
          notifyNeedsPermission={notifyPerm !== 'granted' && notifyPerm !== 'unsupported'}
          onEnableNotifications={async () => {
            const p = await requestCleaningNotificationPermission();
            setNotifyPerm(p);
          }}
          dailySales={dailySalesQ.data}
          dailySalesOk={dailySalesQ.isSuccess}
          dailyIncidents={dailyIncidentsQ.data}
          dailyIncidentsOk={dailyIncidentsQ.isSuccess}
          creditsByMachineId={creditsByMachineId}
          vendonByMachineId={vendonSummaryQ.data?.byMachineId}
          vendonSalesLabels={vendonSalesLabels}
          liveCleaningByMachineId={liveCleaningByMachineId}
          operatorActivityByMachineId={operatorActivityQ.data?.byMachineId}
          fleetPrimaryKwd={fleetRevenueTotals.primary}
          fleetBaselineKwd={fleetRevenueTotals.baseline}
          fleetTrendPct={fleetRevenueTotals.trendPct}
          snapTime={snapTime}
          onRefresh={() => void q.refetch()}
          onOpenDetail={openDetail}
          onOpenSales={(d) => {
            const row = d.row;
            const machId = String(getMachineIdRaw(row) || '');
            const salesRow = salesElapsedForMachine(dailySalesQ.data, machId, dailySalesQ.isSuccess);
            const vendonSales = vendonSummaryQ.data?.byMachineId?.[machId];
            const salesPair = salesPairForPreset(compare.preset, salesRow, compare, vendonSales, vendonSalesLabels);
            const salesForModal =
              salesRow ??
              (salesPair.primary != null && Number.isFinite(salesPair.primary)
                ? {
                    todayKwd: salesPair.primary,
                    dailyElapsed: [],
                    trendPct: salesPair.trendPct ?? null,
                  }
                : null);
            if (salesForModal) openSalesHistory(row, machId, salesForModal as SalesElapsedRow);
          }}
          onOpenTrend={(d) => {
            const machId = String(getMachineIdRaw(d.row) || '');
            openTrendHistory(d.row, machId);
          }}
          onOpenDrinks={(d) => {
            const machId = String(getMachineIdRaw(d.row) || '');
            if (!machId) return;
            setDrinksDetail({
              machineId: machId,
              machineName: String(d.row.machineName || machId),
            });
          }}
        />
        {detail
          ? createPortal(<DetailModal view={detail} onClose={() => setDetail(null)} />, getAlertModalPortal())
          : null}
        {trendDetail ? (
          <TrendHistoryModal
            machineName={trendDetail.machineName}
            machineId={trendDetail.machineId}
            row={trendDetail.row}
            meta={dailyIncidentsQ.data}
            compareMode={compareMode}
            snapTrend={trendDetail.snapTrend}
            scoreText={trendDetail.scoreText}
            trendText={trendDetail.trendText}
            gapDisplay={trendDetail.gapDisplay}
            scoreExplain={trendDetail.scoreExplain}
            trendExplain={trendDetail.trendExplain}
            gapExplain={trendDetail.gapExplain}
            operatorName={trendDetail.operatorName}
            strikeOperatorEmail={trendDetail.strikeOperatorEmail}
            attendanceSummary={trendDetail.attendanceSummary}
            onClose={() => setTrendDetail(null)}
          />
        ) : null}
        {salesDetail ? (
          <SalesHistoryModal
            machineName={salesDetail.machineName}
            machineId={salesDetail.machineId}
            row={salesDetail.row}
            meta={dailySalesQ.data}
            operatorName={salesDetail.operatorName}
            strikeOperatorEmail={salesDetail.strikeOperatorEmail}
            attendanceSummary={salesDetail.attendanceSummary}
            onClose={() => setSalesDetail(null)}
          />
        ) : null}
        {downtimeDetail ? (
          <DowntimeDetailModal
            machineName={downtimeDetail.machineName}
            machineId={downtimeDetail.machineId}
            todayLabel={downtimeQ.data?.labelToday?.trim() || 'Today'}
            periodLabel={downtimeQ.data?.labelPeriod?.trim() || 'Period'}
            todaySec={downtimeDetail.todaySec}
            periodSec={downtimeDetail.periodSec}
            trendPct={downtimeDetail.trendPct}
            onClose={() => setDowntimeDetail(null)}
          />
        ) : null}
        {targetDetail ? (
          <TargetDetailModal
            machineName={targetDetail.machineName}
            machineId={targetDetail.machineId}
            todayKwd={targetDetail.todayKwd}
            yesterdayKwd={targetDetail.yesterdayKwd}
            dailyTargetKd={targetDetail.dailyTargetKd}
            locationOwnerName={targetDetail.locationOwnerName}
            onClose={() => setTargetDetail(null)}
          />
        ) : null}
        {sxDetail ? (
          <SxDetailModal
            machineName={sxDetail.machineName}
            machineId={sxDetail.machineId}
            sxRow={sxDetail.sxRow}
            presetQuery={presetApiQueryString(compare.preset, compare)}
            performancePath={manus ? '/v2/performance' : '/performance'}
            onClose={() => setSxDetail(null)}
          />
        ) : null}
        {goCheckDetail ? (
          <GoCheckWorkflowModal
            machineId={goCheckDetail.machineId}
            machineName={goCheckDetail.machineName}
            alertType={goCheckDetail.alertType}
            onClose={() => setGoCheckDetail(null)}
          />
        ) : null}
        {drinksDetail ? (
          <ProductExtremesModal
            machineName={drinksDetail.machineName}
            machineId={drinksDetail.machineId}
            {...vendonExtremesLists(
              vendonSummaryQ.data?.byMachineId?.[drinksDetail.machineId],
            )}
            periodLabel={vendonSalesLabels.primary || vendonSummaryQ.data?.labelA}
            periodStart={vendonSummaryQ.data?.dateAStart}
            periodEndExclusive={vendonSummaryQ.data?.dateAEnd}
            onClose={() => setDrinksDetail(null)}
          />
        ) : null}
      </>
    );
  }

  const boardInner = (
    <>
        <div className="opsPrepCompact">
          <div className="opsPrepRow">
            <div className="stitchOpsControls opsPrepControls">
              <ComparePresetPicker value={compare} onChange={setComparePersist} />
            </div>
            {compactOps ? (
              <OpsViewToggle
                ariaLabel="Red Flags layout"
                value={redView}
                onChange={(id) => setRedViewPersist(id as RedFlagsViewMode)}
                options={[
                  { id: 'cards', label: 'Cards' },
                  { id: 'table', label: 'Table' },
                ]}
              />
            ) : null}
          </div>
          {tableViewActive ? (
            <RedFlagsColumnPicker
              compact
              stored={columnStored}
              visibleKeys={visibleColumns}
              visibleCount={visibleColumns.length}
              syncState={columnSyncState}
              onChange={handleColumnsChange}
            />
          ) : null}
          <p className="opsPrepSalesLine">
            <strong>Sales</strong> — {salesComparisonNote}
            {dailySalesQ.data?.asOfLocal ? ` · ${dailySalesQ.data.asOfLocal.replace('T', ' ')} KWT` : ''}
          </p>
        </div>

        {cleaningOverdueCount > 0 ? (
          <div className="stitchOpsAlert stitchOpsAlertWarn opsAlertInline" role="status">
            <strong>Cleaning overdue ({cleaningOverdueCount})</strong> — rows highlighted in red. Tap the{' '}
            <strong>alert icon</strong> on <strong>Last clean</strong> → choose <strong>Workflow</strong> →{' '}
            <strong>Send to operator Workflow inbox</strong> (Slack/Email/WhatsApp remain copy-only).
            {notifyPerm !== 'granted' && notifyPerm !== 'unsupported' ? (
              <>
                {' '}
                <button
                  type="button"
                  className="linkGo"
                  onClick={async () => {
                    const p = await requestCleaningNotificationPermission();
                    setNotifyPerm(p);
                  }}
                >
                  Enable browser alerts
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {!q.isFetched && !q.isError ? (
          <p className="stitchOpsAlert stitchOpsAlertInfo opsAlertInline" role="status">
            Loading snapshot…
          </p>
        ) : null}
        {emptyClear ? (
          <p className="stitchOpsAlert stitchOpsAlertInfo opsAlertInline" role="status">
            All clear — no machines match right now.
          </p>
        ) : null}
        {q.isError ? (
          <div className="stitchOpsAlert opsAlertInline" role="alert">
            {(q.error as Error)?.message ?? 'Request failed'}
          </div>
        ) : null}

        {ranked.length > 0 && compactOps && redView === 'cards' ? (
          <section className="opsDashboardSection opsDashboardSection--data" aria-label="Flagged machines">
            <div className="opsDashboardSectionBody opsDashboardSectionBody--data">
          <RedFlagsCardList
            ranked={displayRanked}
            compare={compare}
            compareMode={compareMode}
            dailySales={dailySalesQ.data}
            dailySalesOk={dailySalesQ.isSuccess}
            dailyIncidents={dailyIncidentsQ.data}
            dailyIncidentsOk={dailyIncidentsQ.isSuccess}
            creditsByMachineId={creditsByMachineId}
            vendonByMachineId={vendonSummaryQ.data?.byMachineId}
            vendonSalesLabels={vendonSalesLabels}
            workflowByMachineId={workflowAttendanceQ.data?.byMachineId}
            workflowConfigured={workflowAttendanceQ.data?.configured !== false}
            workflowLoaded={workflowAttendanceQ.isFetched}
            liveCleaningByMachineId={liveCleaningByMachineId}
            operatorActivityByMachineId={operatorActivityQ.data?.byMachineId}
            slackEmailMap={slackContact.map}
            slackTeamId={slackContact.team}
            onOpenDetail={openDetail}
            onOpenSales={(machineName, machineId, row, strikeEmail, opName) =>
              setSalesDetail({
                machineName,
                machineId,
                row,
                operatorName: opName,
                strikeOperatorEmail: strikeEmail,
              })
            }
            onOpenDrinks={(machineName, machineId) =>
              setDrinksDetail({ machineName, machineId })
            }
            onOpenTrend={(machineName, machineId, row, snapTrend, freqCtx, strikeEmail, opName) =>
              setTrendDetail({
                machineName,
                machineId,
                row,
                snapTrend,
                scoreText: freqCtx.scoreText,
                trendText: freqCtx.trendText,
                gapDisplay: freqCtx.gapDisplay,
                scoreExplain: freqCtx.scoreExplain,
                trendExplain: freqCtx.trendExplain,
                gapExplain: freqCtx.gapExplain,
                operatorName: opName,
                strikeOperatorEmail: strikeEmail,
              })
            }
          />
            </div>
          </section>
        ) : null}

        {tableViewActive ? (
          <section className="opsDashboardSection opsDashboardSection--data" aria-label="Live checklist">
            <div className="opsDashboardSectionBody opsDashboardSectionBody--data">
          <div className="opsTableLead">
            <span className="opsTableLeadTitle">Checklist</span>
            <span className="opsDashboardSectionBadge">
              {ranked.length} rows · {visibleColumns.length} cols
            </span>
          </div>
          <TableScrollControls>
            <table className={`${styles.table} stitchOpsTable`}>
                <thead>
                  <tr>{visibleColumns.map((key) => renderRedFlagsHeaderCell(key, headerCtx))}</tr>
                </thead>
                <tbody>
                  {displayRanked.map((d, r) => {
                    const row = d.row;
                    const machId = String(getMachineIdRaw(row) || '');
                    const cred = machId ? creditsByMachineId[machId] : undefined;
                    const creditsSentN = cred?.credits_sent != null ? Number(cred.credits_sent) : NaN;
                    const dispenseTestsN = cred?.dispense_tests != null ? Number(cred.dispense_tests) : NaN;
                    const vendsResolved = cred?.vends_resolved;
                    const cleanIso = pickLastCleaningIso(row, liveByMachineId.get(machId)?.lastCleaningAt);
                    const cleanWins = cleaningWindowsFromAdmin(cred?.cleaning_windows);
                    const cleanStatus = cleanIso
                      ? lastCleanedStatus({ lastCleaningIso: cleanIso, cleaningWindows: cleanWins })
                      : null;
                    const incidentsRow = resolveIncidentsRow(
                      row,
                      incidentsElapsedForMachine(dailyIncidentsQ.data, machId, dailyIncidentsQ.isSuccess),
                    );
                    const freqCtx = buildFreqColumnContext(row, compareMode, incidentsRow);
                    const fq = freqCtx.fq;
                    const freqVisual = freqBoxVisuals(row, compareMode, incidentsRow);
                    const scoreText = freqCtx.scoreText;
                    const hitsN = (() => {
                      const m = /^(\d+)\//.exec(scoreText);
                      if (m) return Number(m[1]);
                      return NaN;
                    })();
                    const scoreKnown = !Number.isNaN(hitsN);
                    const gapDisplay = freqCtx.gapDisplay;
                    const gapN = (() => {
                      const m = /^↓(\d+)$/.exec(gapDisplay);
                      if (m) return Number(m[1]);
                      if (gapDisplay === '↓0') return 0;
                      return NaN;
                    })();
                    const gapNeutral = Number.isNaN(gapN);
                    const snapTrend = buildSnapTrend(row);
                    const canOpenTrend = canOpenIncidentHistory(incidentsRow, snapTrend);
                    const pri = row.alertPriorityTier != null ? Number(row.alertPriorityTier) : 1;
                    const p2 = pri === 2 || !!row.duringScheduledCleaningNow;
                    const cleaningOverdue = !!row.cleaningOverdue15h;
                    const hwN = rowHappensForSort(row, compareMode, incidentsRow);
                    const hot = hwN >= 10;
                    const rk = r === 0 ? 1 : Math.max(0, 0.58 - (r - 1) * 0.055);
                    const strikeEmail = getStrikeOperatorEmail(row);
                    let goUrl = row.goCheckUrl || null;
                    if (!goUrl && strikeEmail) {
                      goUrl = `mailto:${strikeEmail}?subject=${encodeURIComponent(`Red Flags — GO CHECK: ${row.machineName || machId}`)}`;
                    }
                    const alertTypeText =
                      row.reasons && row.reasons.length
                        ? String(row.reasons[row.reasons.length - 1] ?? '')
                            .replace(/\s+/g, ' ')
                            .trim()
                        : '—';
                    const alertTypeShow =
                      alertTypeText.length > 140 ? `${alertTypeText.slice(0, 140)}…` : alertTypeText;
                    const salesRow = salesElapsedForMachine(dailySalesQ.data, machId, dailySalesQ.isSuccess);
                    const vendonSales = vendonSummaryQ.data?.byMachineId?.[machId];
                    const salesPair = salesPairForPreset(
                      compare.preset,
                      salesRow,
                      compare,
                      vendonSales,
                      vendonSalesLabels,
                    );
                    const targetKwd = targetKwdForPreset(salesPair);
                    const qaVisit = qaVisitForMachineName(
                      String(row.machineName || machId),
                      qaSummaryQ.data?.byLocationKey,
                      qaSummaryQ.data?.adminSummaryMtdByMachine,
                      qaSummaryQ.data?.latestByMachine,
                    );
                    const techVisit = techVisitForMachineName(
                      String(row.machineName || machId),
                      qaSummaryQ.data?.byLocationKeyTech,
                    );
                    const qaFindings = qaFindingsForMachineName(
                      String(row.machineName || machId),
                      qaFindingsQ.data?.findings,
                    );

                    const bundle: RedFlagsRowBundle = {
                      d,
                      row,
                      machId,
                      r,
                      cred,
                      creditsSentN,
                      dispenseTestsN,
                      vendsResolved,
                      cleanIso,
                      cleanStatus,
                      cleaningWindows: cleanWins,
                      noSalesAlert: (() => {
                        const ageFromSnap =
                          row.minutesSinceLastTransaction != null
                            ? Number(row.minutesSinceLastTransaction)
                            : row.minutes_since_last_transaction != null
                              ? Number(row.minutes_since_last_transaction)
                              : null;
                        const txTs = vendonLastTxQ.data?.byMachineId?.[machId]?.timestamp;
                        const age =
                          ageFromSnap ??
                          lastTxAgeMinutes(txTs != null ? Number(txTs) : null);
                        return isNoSalesAlert(age);
                      })(),
                      noSalesHours: NO_SALES_ALERT_HOURS,
                      incidentsRow: incidentsRow ?? { todayHits: undefined },
                      freqCtx,
                      fq,
                      freqVisual,
                      scoreText,
                      trendText: freqCtx.trendText,
                      hitsN,
                      scoreKnown,
                      gapDisplay,
                      gapN,
                      gapNeutral,
                      freqColumnTooltip: freqCtx.freqColumnTooltip,
                      canOpenTrend,
                      p2,
                      alertTypeText,
                      alertTypeShow,
                      salesRow,
                      salesPair,
                      comparePreset: compare.preset,
                      targetKwd,
                      mtdSalesKwd: mtdVendonQ.data?.byMachineId?.[machId]?.aSalesKwd,
                      mtdYoySalesKwd: mtdYoyVendonQ.data?.byMachineId?.[machId]?.aSalesKwd,
                      mtdYoyLyKwd: mtdYoyVendonQ.data?.byMachineId?.[machId]?.bSalesKwd,
                      mtdYoyTrendPct: mtdYoyVendonQ.data?.byMachineId?.[machId]?.trendPct,
                      sxRow: sxQ.data?.byMachineId?.[machId] ?? null,
                      downtimeRow: downtimeQ.data?.byMachineId?.[machId] ?? null,
                      downtimeTodayLabel: downtimeQ.data?.labelToday?.trim() || 'Today',
                      downtimePeriodLabel: downtimeQ.data?.labelPeriod?.trim() || 'Period',
                      onOpenDowntime: machId
                        ? () => {
                            const dt = downtimeQ.data?.byMachineId?.[machId];
                            setDowntimeDetail({
                              machineId: machId,
                              machineName: String(row.machineName || machId),
                              todaySec: dt?.todaySec,
                              periodSec: dt?.periodSec,
                              trendPct: dt?.trendPct,
                            });
                          }
                        : undefined,
                      qaVisit,
                      techVisit,
                      qaFindings,
                      qaLoading:
                        qaSummaryQ.isLoading ||
                        qaFindingsQ.isLoading ||
                        (qaSummaryQ.isFetching &&
                          !(qaSummaryQ.data?.latestByMachine && Object.keys(qaSummaryQ.data.latestByMachine).length)),
                      // Findings Slack errors must not blank QA/Tech visit cells.
                      qaError: qaSummaryQ.data?.error || null,
                      goUrl,
                      slackEmailMap: slackContact.map,
                      slackTeamId: slackContact.team,
                      snapTime,
                      vendonTxIso: vendonTxIsoFromEntry(vendonLastTxQ.data?.byMachineId?.[machId]),
                      clockMs: clock.getTime(),
                      operatorActivity: operatorActivityQ.data?.byMachineId?.[machId] ?? null,
                      areaOwnerName: resolveAreaOwnerPerson(machId),
                      locationOwnerFull: resolveLocationOwnerForRow(machId, String(row.machineName || machId)),
                      locationTagOwner: resolveLocationTagForRow(machId, String(row.machineName || machId)),
                      machineInactive: locationOwnerLookup.inactiveById.get(machId)?.inactive === true,
                      machineInactiveLabel: locationOwnerLookup.inactiveById.get(machId)?.label || 'Inactive',
                      locHours: locationOwnerLookup.hoursById.get(machId)?.locHours || '',
                      operatingDaysLabel: locationOwnerLookup.hoursById.get(machId)?.operatingDaysLabel || '',
                      timezoneLabel: locationOwnerLookup.hoursById.get(machId)?.timezoneLabel || '',
                      workflowAttendance: workflowAttendanceQ.data?.byMachineId?.[machId],
                      workflowCleaning: workflowCleaningQ.data?.byMachineId?.[machId],
                      workflowConfigured: workflowAttendanceQ.data?.configured !== false,
                      workflowLoaded: workflowAttendanceQ.isFetched,
                      onOpenTrend: () => {
                        openTrendHistory(row, machId, incidentsRow);
                      },
                      onOpenSales: () => {
                        const salesForModal =
                          salesRow ??
                          (salesPair.primary != null && Number.isFinite(salesPair.primary)
                            ? {
                                todayKwd: salesPair.primary,
                                dailyElapsed: [],
                                trendPct: salesPair.trendPct ?? null,
                              }
                            : null);
                        if (salesForModal) {
                          openSalesHistory(row, machId, salesForModal as SalesElapsedRow);
                        }
                      },
                      onOpenTarget: () => {
                        if (!machId) return;
                        const elapsedToday = salesDayKwd(salesRow, 0);
                        const elapsedYesterday = salesDayKwd(salesRow, 1);
                        const ownerFull = resolveLocationOwnerForRow(machId, String(row.machineName || machId));
                        setTargetDetail({
                          machineName: String(row.machineName || machId),
                          machineId: machId,
                          todayKwd: targetKwd.todayKwd ?? elapsedToday ?? undefined,
                          yesterdayKwd: targetKwd.yesterdayKwd ?? elapsedYesterday ?? undefined,
                          dailyTargetKd: row.dailyTarget,
                          locationOwnerName: ownerFull,
                        });
                      },
                      onOpenPerformance: () => {
                        if (!machId) return;
                        setSxDetail({
                          machineName: String(row.machineName || machId),
                          machineId: machId,
                          sxRow: sxQ.data?.byMachineId?.[machId] ?? null,
                        });
                      },
                      topDrinkName:
                        vendonSummaryQ.data?.byMachineId?.[machId]?.topProducts?.[0]?.name ||
                        vendonSummaryQ.data?.byMachineId?.[machId]?.topProduct?.name ||
                        null,
                      lowDrinkName:
                        vendonSummaryQ.data?.byMachineId?.[machId]?.lowProducts?.[0]?.name ||
                        vendonSummaryQ.data?.byMachineId?.[machId]?.lowProduct?.name ||
                        null,
                      onOpenDrinks: machId
                        ? () =>
                            setDrinksDetail({
                              machineId: machId,
                              machineName: String(row.machineName || machId),
                            })
                        : undefined,
                      onGoCheck: () => {
                        setGoCheckDetail({
                          machineId: machId,
                          machineName: String(row.machineName || machId),
                          alertType: alertTypeText,
                        });
                      },
                    };

                    return (
                      <tr
                        key={machId || `${r}`}
                        className={`${styles.tr} ${d.isNew ? styles.trNew : ''} ${d.isChanged ? styles.trUpdated : ''} ${hot ? styles.rowHot : ''} ${p2 ? styles.rowP2 : ''} ${cleaningOverdue ? styles.rowCleaningOverdue : ''} ${locationOwnerLookup.inactiveById.get(machId)?.inactive ? 'opsRowInactive' : ''}`}
                        style={{ '--ra-rank-strength': rk.toFixed(3) } as CSSProperties}
                        tabIndex={0}
                        onPointerDownCapture={(e) => {
                          captureRowTapTarget(e.target, rowTapTargetRef);
                        }}
                        onClick={(e) => {
                          handleRowClickActivate(e, rowTapTargetRef, () => openDetail(d));
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            if (isRowInteractiveTarget(ev.target)) return;
                            ev.preventDefault();
                            openDetail(d);
                          }
                        }}
                      >
                        {visibleColumns.map((colKey) => {
                          const cellProps = redFlagsBodyCellProps(colKey, bundle);
                          return (
                            <td key={colKey} className={redFlagsBodyCellClass(colKey)} {...cellProps}>
                              {renderRedFlagsBodyCell(colKey, bundle)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          </TableScrollControls>
            </div>
          </section>
        ) : null}
    </>
  );

  const fleetBar =
    ranked.length > 0 ? (
        <OpsRevenueTotalsBar
          totals={fleetRevenueTotals}
          machineCount={fleetRevenueTotals.machineCount}
          loading={fleetRevenueTotals.loading || dailySalesQ.isLoading || !dailySalesQ.isFetched}
          asOfLocal={dailySalesQ.data?.asOfLocal}
          salesFreshnessNote={
            dailySalesQ.isFetched
              ? formatAgeShort(
                  dailySalesQ.data?.cacheGeneratedAt ?? dailySalesQ.data?.asOfLocal,
                ) || (dailySalesQ.isFetching ? 'updating…' : null)
              : null
          }
          cacheTrustNote={
            dailySalesQ.isFetched ? formatFleetRevenueCacheTrustNote(dailySalesQ.data) : null
          }
          yesterdayOverall={fleetYesterdayOverall}
          monthToDate={
            dailySalesQ.data
              ? {
                  primary: dailySalesQ.data.fleetMtdKwd ?? null,
                  baseline: dailySalesQ.data.fleetLastMtdKwd ?? null,
                  trendPct: dailySalesQ.data.fleetMtdTrendPct ?? null,
                  primaryLabel: 'MTD',
                  baselineLabel: 'Last MTD',
                }
              : null
          }
          yearToDate={
            dailySalesQ.data
              ? {
                  primary: dailySalesQ.data.fleetYtdKwd ?? null,
                  baseline: dailySalesQ.data.fleetLastYtdKwd ?? null,
                  trendPct: dailySalesQ.data.fleetYtdTrendPct ?? null,
                  primaryLabel: 'YTD',
                  baselineLabel: 'LY YTD',
                }
              : null
          }
        />
      ) : null;

  const modals = (
    <>
      {detail
        ? createPortal(<DetailModal view={detail} onClose={() => setDetail(null)} />, getAlertModalPortal())
        : null}
      {trendDetail ? (
        <TrendHistoryModal
          machineName={trendDetail.machineName}
          machineId={trendDetail.machineId}
          row={trendDetail.row}
          meta={dailyIncidentsQ.data}
          compareMode={compareMode}
          snapTrend={trendDetail.snapTrend}
          scoreText={trendDetail.scoreText}
          trendText={trendDetail.trendText}
          gapDisplay={trendDetail.gapDisplay}
          scoreExplain={trendDetail.scoreExplain}
          trendExplain={trendDetail.trendExplain}
          gapExplain={trendDetail.gapExplain}
          operatorName={trendDetail.operatorName}
          strikeOperatorEmail={trendDetail.strikeOperatorEmail}
          attendanceSummary={trendDetail.attendanceSummary}
          onClose={() => setTrendDetail(null)}
        />
      ) : null}
      {salesDetail ? (
        <SalesHistoryModal
          machineName={salesDetail.machineName}
          machineId={salesDetail.machineId}
          row={salesDetail.row}
          meta={dailySalesQ.data}
          operatorName={salesDetail.operatorName}
          strikeOperatorEmail={salesDetail.strikeOperatorEmail}
          attendanceSummary={salesDetail.attendanceSummary}
          onClose={() => setSalesDetail(null)}
        />
      ) : null}
      {downtimeDetail ? (
        <DowntimeDetailModal
          machineName={downtimeDetail.machineName}
          machineId={downtimeDetail.machineId}
          todayLabel={downtimeQ.data?.labelToday?.trim() || 'Today'}
          periodLabel={downtimeQ.data?.labelPeriod?.trim() || 'Period'}
          todaySec={downtimeDetail.todaySec}
          periodSec={downtimeDetail.periodSec}
          trendPct={downtimeDetail.trendPct}
          onClose={() => setDowntimeDetail(null)}
        />
      ) : null}
      {targetDetail ? (
        <TargetDetailModal
          machineName={targetDetail.machineName}
          machineId={targetDetail.machineId}
          todayKwd={targetDetail.todayKwd}
          yesterdayKwd={targetDetail.yesterdayKwd}
          dailyTargetKd={targetDetail.dailyTargetKd}
          locationOwnerName={targetDetail.locationOwnerName}
          onClose={() => setTargetDetail(null)}
        />
      ) : null}
      {sxDetail ? (
        <SxDetailModal
          machineName={sxDetail.machineName}
          machineId={sxDetail.machineId}
          sxRow={sxDetail.sxRow}
          presetQuery={presetApiQueryString(compare.preset, compare)}
          performancePath={manus ? '/v2/performance' : '/performance'}
          onClose={() => setSxDetail(null)}
        />
      ) : null}
      {goCheckDetail ? (
        <GoCheckWorkflowModal
          machineId={goCheckDetail.machineId}
          machineName={goCheckDetail.machineName}
          alertType={goCheckDetail.alertType}
          onClose={() => setGoCheckDetail(null)}
        />
      ) : null}
      {drinksDetail ? (
        <ProductExtremesModal
          machineName={drinksDetail.machineName}
          machineId={drinksDetail.machineId}
          {...vendonExtremesLists(
            vendonSummaryQ.data?.byMachineId?.[drinksDetail.machineId],
          )}
          periodLabel={vendonSalesLabels.primary || vendonSummaryQ.data?.labelA}
          periodStart={vendonSummaryQ.data?.dateAStart}
          periodEndExclusive={vendonSummaryQ.data?.dateAEnd}
          onClose={() => setDrinksDetail(null)}
        />
      ) : null}
    </>
  );

  if (manus) {
    return (
      <div className={`${styles.root} v2ManusBoard`}>
        <div className="v2KpiGrid">
          {redKpis.map((k) => (
            <V2KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              detail={k.sub || ''}
              tone={k.tone === 'warn' ? 'amber' : k.tone === 'good' ? 'teal' : 'slate'}
              icon="red_flags"
            />
          ))}
        </div>
        <V2Panel
          title="Exception board"
          subtitle={`${ranked.length} machines · ${visibleColumns.length} Classic fields`}
          meta={
            <V2GhostBtn onClick={() => void q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? 'Refreshing…' : 'Refresh'}
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
    <div className={styles.root}>
      <StitchOpsPanel
        compact
        iconName="red_flags"
        title="Red Flags"
        badge={emptyClear ? 'All clear' : `${ranked.length} machine${ranked.length === 1 ? '' : 's'}`}
        metaLine={
          generatedAt ? (
            <>
              Snap {generatedAt}
              {q.isFetching && ranked.length ? ' · updating' : ''}
            </>
          ) : null
        }
        kpis={redKpis}
        toolbar={
          <>
            <FleetOpsToolbarExtras
              search={fleetSearch}
              onSearchChange={setFleetSearch}
              riskSort={riskSort}
              onRiskSortChange={(v) => {
                setRiskSort(v);
                if (v) setSalesSort(false);
              }}
              salesSort={salesSort}
              onSalesSortChange={(v) => {
                setSalesSort(v);
                if (v) setRiskSort(false);
              }}
              hideInactive={hideInactive}
              onHideInactiveChange={setHideInactive}
            />
            <span className="stitchOpsLive">
              <span className="stitchOpsLiveDot" aria-hidden />
              Live · ~1m
            </span>
            <button
              type="button"
              className="stitchOpsRefresh stitchOpsRefreshCompact"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
            >
              {q.isFetching ? '…' : 'Refresh'}
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
