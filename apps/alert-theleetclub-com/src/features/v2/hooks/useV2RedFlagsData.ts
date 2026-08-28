import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import {
  baselineReasonMap,
  filterSnapshotRows,
  getMachineIdRaw,
  getOperatorDisplayName,
  getStrikeOperatorEmail,
  pickLastCleaningIso,
  pickLastTransactionTs,
  rankRows,
  reasonKey,
  rowHappensForSort,
} from '@/features/redflags/redFlagsModel';
import {
  formatKwd,
  formatSalesTrendPct,
  salesDayKwd,
  salesElapsedForMachine,
  type DailySalesElapsedResponse,
} from '@/lib/salesDisplay';
import { formatLastTxCompact } from '@/features/redflags/redFlagsFreqUi';
import { formatDowntimeSec, formatDowntimeTrendLabel } from '@/lib/downtimeDisplay';
import {
  qaVisitForMachineName,
  techVisitForMachineName,
  type QaSummaryResponse,
} from '@/lib/qaVisitDisplay';
import {
  resolveLatestOperatorActivity,
  type OperatorActivityTimes,
} from '@/components/OperatorActivityCell';
import type { SxAccelerationRow } from '@/components/SxAccelerationCell';
import { formatKuwaitActivityStamp } from '@/lib/formatKuwait';
import { RED_FLAGS_XLSX_ORDER, type RedFlagsColumnKey } from '@/features/redflags/redFlagsWorkbookColumns';
import { RED_FLAGS_TABLE_HEADERS } from '@/lib/tableHeaderLabels';
import {
  comparePresetToRedAlertMode,
  initialCompareSelection,
  persistCompareSelection,
  presetApiQueryString,
} from '@/lib/comparePresetBridge';
import type { DailyIncidentsElapsedResponse } from '@/lib/incidentsDisplay';
import {
  fetchCleaningWorkflowMapBatched,
  fetchMachineAttendanceMapBatched,
} from '@/lib/leetWorkflowApi';
import { salesPairForPreset } from '@/lib/presetComparison';
import type { V2MetricItem, V2MetricTone } from '@/features/v2/V2MetricStack';

type Snapshot = {
  rows?: RedAlertRow[];
  error?: string;
  generatedAt?: string;
  cacheGeneratedAt?: string;
};
type CreditsTotals = {
  byMachineId?: Record<
    string,
    { credits_sent?: number; dispense_tests?: number; vends_resolved?: string }
  >;
};
type VendonLastTransactionsResponse = {
  byMachineId?: Record<string, { timestamp?: number; product_name?: string | null }>;
};

const WIDE_COLS = new Set<RedFlagsColumnKey>([
  'dailySales',
  'mtdSales',
  'mtdYoySales',
  'dailyTarget',
  'salesAcceleration',
  'frequency',
  'downtime',
  'qaVisit',
  'lastTransaction',
  'operatorActivity',
  'lastCleaning',
]);

export type V2ExceptionRow = {
  id: string;
  machineName: string;
  severity: 'Critical' | 'Watch';
  isNew: boolean;
  fields: Record<RedFlagsColumnKey, string>;
  stacks: Partial<Record<RedFlagsColumnKey, V2MetricItem[]>>;
  reasons: string[];
  topProducts?: Array<{ name?: string | null; count?: number | null }> | null;
  lowProducts?: Array<{ name?: string | null; count?: number | null }> | null;
  distinctDrinksSold?: number | null;
  productMixCachedAt?: string | null;
};

/** Classic priority: tier 1 = immediate (Critical), tier 2 = cleaning-window Watch. */
function severityForRow(row: RedAlertRow): 'Critical' | 'Watch' {
  const pri = Number(row.alertPriorityTier != null ? row.alertPriorityTier : 1);
  if (pri === 2 || row.duringScheduledCleaningNow) return 'Watch';
  return 'Critical';
}

function toneFromPct(pct: number | null | undefined): V2MetricTone {
  if (pct == null || !Number.isFinite(pct)) return 'muted';
  if (pct > 0.5) return 'up';
  if (pct < -0.5) return 'down';
  return 'flat';
}

function sxStack(sx?: SxAccelerationRow | null): V2MetricItem[] {
  const loc = sx?.location?.sxPct;
  return [
    {
      label: 'Loc SX',
      value: loc != null && Number.isFinite(Number(loc)) ? formatSalesTrendPct(Number(loc)).replace(/%$/, ' pts') : '—',
      tone: toneFromPct(loc != null ? Number(loc) : null),
    },
  ];
}

export const V2_RED_FLAGS_COLUMNS = RED_FLAGS_XLSX_ORDER.map((key) => ({
  key,
  label: RED_FLAGS_TABLE_HEADERS[key].main,
  sub: RED_FLAGS_TABLE_HEADERS[key].sub,
  sticky: key === 'vendingMachine',
  wide: WIDE_COLS.has(key),
}));

export function useV2RedFlagsData(compare?: CompareSelection) {
  const compareSel = compare ?? initialCompareSelection();
  const compareMode = useMemo(
    () => comparePresetToRedAlertMode(compareSel.preset),
    [compareSel.preset],
  );
  const prevReasonRef = useRef<Record<string, string>>({});
  const hasLoadedRef = useRef(false);

  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    staleTime: 45_000,
    refetchInterval: 60_000,
  });

  const machineIdsKey = useMemo(() => {
    const rows = filterSnapshotRows(snapQ.data?.rows || []);
    const ids = rows.map((r) => getMachineIdRaw(r)).filter(Boolean);
    ids.sort();
    return ids.join(',');
  }, [snapQ.data?.rows]);

  const salesQ = useQuery({
    queryKey: ['alert-daily-sales-elapsed', compareSel.preset, 'v2'],
    queryFn: () => apiGet<DailySalesElapsedResponse>('/api/alert/overall/daily-sales-elapsed'),
    enabled: snapQ.isFetched,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const vendonLastTxQ = useQuery({
    queryKey: ['alert-overall-vendon-last-transactions', 'v2'],
    queryFn: () => apiGet<VendonLastTransactionsResponse>('/api/alert/overall/last-transactions'),
    enabled: snapQ.isFetched,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const vendonSummaryQ = useQuery({
    queryKey: [
      'alert-vendon-sales-summary',
      compareSel.preset,
      compareSel.a.start,
      compareSel.a.end,
      compareSel.b.start,
      compareSel.b.end,
      'v2',
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
            topProduct?: { name?: string | null } | null;
            lowProduct?: { name?: string | null } | null;
            topProducts?: Array<{ name?: string | null }> | null;
            lowProducts?: Array<{ name?: string | null }> | null;
            distinctDrinksSold?: number | null;
            productMixCachedAt?: string | null;
          }
        >;
      }>(`/api/alert/overall/vendon-sales-summary?${presetApiQueryString(compareSel.preset, compareSel)}`),
    enabled: snapQ.isFetched,
    staleTime: 2 * 60_000,
  });

  const mtdQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd', 'v2'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { aSalesKwd?: number | null }> }>(
        '/api/alert/overall/vendon-sales-summary?preset=mtd_vs_mtd',
      ),
    enabled: snapQ.isFetched,
    staleTime: 2 * 60_000,
  });

  const mtdYoyQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd-yoy', 'v2'],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<
          string,
          { aSalesKwd?: number | null; bSalesKwd?: number | null; trendPct?: number | null }
        >;
      }>('/api/alert/overall/vendon-sales-summary?preset=mtd_vs_yoy'),
    enabled: snapQ.isFetched,
    staleTime: 2 * 60_000,
  });

  const sxQ = useQuery({
    queryKey: [
      'alert-sales-acceleration',
      compareSel.preset,
      compareSel.a.start,
      compareSel.a.end,
      compareSel.b.start,
      compareSel.b.end,
      'v2',
    ],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, SxAccelerationRow> }>(
        `/api/alert/overall/sales-acceleration?${presetApiQueryString(compareSel.preset, compareSel)}`,
      ),
    enabled: snapQ.isFetched,
    staleTime: 2 * 60_000,
  });

  const downtimeQ = useQuery({
    queryKey: [
      'alert-downtime-summary',
      compareSel.preset,
      compareSel.a.start,
      compareSel.a.end,
      compareSel.b.start,
      compareSel.b.end,
      'v2',
    ],
    queryFn: () =>
      apiGet<import('@/lib/downtimeDisplay').DowntimeSummaryResponse>(
        `/api/alert/overall/downtime-summary?${presetApiQueryString(compareSel.preset, compareSel)}`,
      ),
    enabled: snapQ.isFetched,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const creditsQ = useQuery({
    queryKey: ['alert-remote-credits-today-totals', machineIdsKey, 'v2'],
    queryFn: async () => {
      const base = '/api/alert/remote-credits/today-totals';
      const ids = machineIdsKey.split(',').filter(Boolean);
      if (!ids.length) return apiGet<CreditsTotals>(base);
      const merged: NonNullable<CreditsTotals['byMachineId']> = {};
      for (let i = 0; i < ids.length; i += 12) {
        const chunk = ids.slice(i, i + 12).join(',');
        try {
          const part = await apiGet<CreditsTotals>(`${base}?machines=${encodeURIComponent(chunk)}`);
          Object.assign(merged, part.byMachineId ?? {});
        } catch {
          /* ignore chunk */
        }
      }
      return { byMachineId: merged };
    },
    enabled: snapQ.isFetched && Boolean(machineIdsKey),
    staleTime: 2 * 60_000,
  });

  const opActQ = useQuery({
    queryKey: ['alert-operator-activity', machineIdsKey, 'v2'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, OperatorActivityTimes> }>(
        machineIdsKey
          ? `/api/alert/operator-activity?machines=${encodeURIComponent(machineIdsKey)}`
          : '/api/alert/operator-activity',
      ),
    enabled: snapQ.isFetched && Boolean(machineIdsKey),
    staleTime: 90_000,
  });

  const qaQ = useQuery({
    queryKey: ['alert-qa-summary', 'v2'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    enabled: snapQ.isFetched,
    staleTime: 60_000,
    refetchInterval: (query) => {
      const d = query.state.data as QaSummaryResponse | undefined;
      if (d?.partial || d?.warning) return 20_000;
      if (!d?.latestByMachine || !Object.keys(d.latestByMachine).length) return 30_000;
      return 5 * 60_000;
    },
  });

  const dailyIncidentsQ = useQuery({
    queryKey: ['alert-daily-incidents-elapsed', compareSel.preset, machineIdsKey, 'v2'],
    queryFn: async () => {
      const base = '/api/alert/red-flags/daily-incidents-elapsed';
      const ids = machineIdsKey.split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return apiGet<DailyIncidentsElapsedResponse>(base);
      const merged: NonNullable<DailyIncidentsElapsedResponse['byMachineId']> = {};
      let asOfLocal: string | undefined;
      let today: string | undefined;
      let yesterday: string | undefined;
      let comparisonNote: string | undefined;
      let timezone: string | undefined;
      let historyDays: number | undefined;
      let historyDates: string[] | undefined;
      for (let i = 0; i < ids.length; i += 12) {
        const chunk = ids.slice(i, i + 12).join(',');
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
        } catch {
          /* ignore chunk */
        }
        if (i + 12 < ids.length) await new Promise((r) => setTimeout(r, 150));
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
    enabled: snapQ.isFetched && Boolean(machineIdsKey),
    staleTime: 2 * 60_000,
  });

  const attendanceQ = useQuery({
    queryKey: ['leet-workflow-attendance-map', machineIdsKey, 'v2'],
    queryFn: () =>
      fetchMachineAttendanceMapBatched(machineIdsKey.split(',').map((s) => s.trim()).filter(Boolean)),
    enabled: snapQ.isFetched && Boolean(machineIdsKey),
    staleTime: 2 * 60_000,
  });

  const cleaningQ = useQuery({
    queryKey: ['leet-workflow-cleaning-map', machineIdsKey, 'v2'],
    queryFn: () =>
      fetchCleaningWorkflowMapBatched(machineIdsKey.split(',').map((s) => s.trim()).filter(Boolean)),
    enabled: snapQ.isFetched && Boolean(machineIdsKey),
    staleTime: 2 * 60_000,
  });

  const liveQ = useQuery({
    queryKey: ['live-dashboard-snapshot', 'v2'],
    queryFn: () =>
      apiGet<{ machines?: Array<{ machineId: string; lastCleaningAt?: string | null }> }>(
        '/api/live-dashboard/snapshot',
      ),
    enabled: snapQ.isFetched,
    staleTime: 30_000,
  });

  const profilesQ = useQuery({
    queryKey: ['alert-overall-admin-profiles', 'v2'],
    queryFn: () =>
      apiGet<{
        rows?: {
          machine_id?: string;
          machine_name?: string;
          location_owner?: string | null;
          location_hours?: string | null;
          timezone?: string | null;
          operating_days?: unknown;
        }[];
      }>('/api/alert/overall/admin-profiles'),
    enabled: snapQ.isFetched,
    staleTime: 5 * 60_000,
  });

  const liveById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const row of liveQ.data?.machines || []) {
      const id = String(row.machineId || '').trim();
      if (id) m.set(id, row.lastCleaningAt ?? null);
    }
    return m;
  }, [liveQ.data?.machines]);

  const ownerById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of profilesQ.data?.rows || []) {
      const id = String(r.machine_id || '').trim();
      const owner = String(r.location_owner || '').trim();
      if (id && owner) m.set(id, owner);
    }
    return m;
  }, [profilesQ.data?.rows]);

  const hoursById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of profilesQ.data?.rows || []) {
      const id = String(r.machine_id || '').trim();
      if (!id) continue;
      const hrs = String(r.location_hours || '').trim();
      m.set(id, hrs ? `${hrs} hrs` : '—');
    }
    return m;
  }, [profilesQ.data?.rows]);

  const snapTime = snapQ.data?.generatedAt || snapQ.data?.cacheGeneratedAt || null;

  const [ranked, setRanked] = useState<ReturnType<typeof rankRows>>([]);

  useLayoutEffect(() => {
    if (!snapQ.data) return;
    const rows = filterSnapshotRows(snapQ.data.rows || []);
    if (!rows.length) {
      prevReasonRef.current = {};
      setRanked([]);
      return;
    }
    let prevMap = prevReasonRef.current;
    if (!hasLoadedRef.current) {
      prevMap = baselineReasonMap(rows);
      hasLoadedRef.current = true;
    }
    const list = rankRows(rows, prevMap, compareMode, dailyIncidentsQ.data?.byMachineId);
    const nextPrev: Record<string, string> = {};
    for (const d of list) {
      nextPrev[String(getMachineIdRaw(d.row) || '')] = reasonKey(d.row);
    }
    prevReasonRef.current = nextPrev;
    setRanked(list);
  }, [snapQ.data, snapQ.dataUpdatedAt, compareMode, dailyIncidentsQ.data?.byMachineId]);

  const vendonLabels = useMemo(
    () => ({
      primary: vendonSummaryQ.data?.labelA?.trim() || undefined,
      baseline: vendonSummaryQ.data?.labelB?.trim() || undefined,
    }),
    [vendonSummaryQ.data?.labelA, vendonSummaryQ.data?.labelB],
  );

  const exceptions = useMemo(() => {
    const out: V2ExceptionRow[] = [];
    for (const { row, isNew } of ranked) {
      const reasons = row.reasons || [];
      if (!reasons.length) continue;
      const id = getMachineIdRaw(row);
      if (!id) continue;
      const name = String(row.machineName || id);
      const sales = salesElapsedForMachine(salesQ.data, id, salesQ.isSuccess);
      const vendonSales = vendonSummaryQ.data?.byMachineId?.[id];
      const salesPair = salesPairForPreset(
        compareSel.preset,
        sales,
        compareSel,
        vendonSales,
        vendonLabels,
      );
      const today = salesPair.primary ?? sales?.todayKwd;
      const yest = salesPair.baseline ?? salesDayKwd(sales, 1);
      const trendPctNum =
        salesPair.trendPct != null && Number.isFinite(Number(salesPair.trendPct))
          ? Number(salesPair.trendPct)
          : sales?.trendPct != null
            ? Number(sales.trendPct)
            : null;
      const mtd = mtdQ.data?.byMachineId?.[id]?.aSalesKwd;
      const yoy = mtdYoyQ.data?.byMachineId?.[id];
      const dailyTarget = row.dailyTarget != null ? Number(row.dailyTarget) : NaN;
      const targetPctNum =
        Number.isFinite(dailyTarget) && dailyTarget > 0 && today != null && Number.isFinite(Number(today))
          ? (Number(today) / dailyTarget) * 100
          : null;
      const targetPct = targetPctNum != null ? `${targetPctNum.toFixed(0)}%` : '—';
      const remain =
        Number.isFinite(dailyTarget) && today != null && Number.isFinite(Number(today))
          ? formatKwd(Math.max(0, dailyTarget - Number(today)))
          : '—';
      const owner = ownerById.get(id) || '—';
      const incidents = dailyIncidentsQ.data?.byMachineId?.[id];
      const primaryHits = rowHappensForSort(row, compareMode, incidents);
      const hw = Number(row.happensWeek ?? row.frequency?.totalCriteriaHitsThisWeek ?? 0);
      const lw = Number(row.happenedLastWeek ?? row.frequency?.totalCriteriaHitsLastWeek ?? 0);
      const todayHits = Number(
        incidents?.todayHits ?? row.happensToday ?? row.frequency?.totalCriteriaHitsToday ?? 0,
      );
      const yestHits = Number(
        incidents?.yesterdaySameElapsedHits ??
          row.happenedYesterdaySameElapsed ??
          row.frequency?.totalCriteriaHitsYesterdaySameElapsed ??
          0,
      );
      const qa = qaVisitForMachineName(
        name,
        qaQ.data?.byLocationKey,
        qaQ.data?.adminSummaryMtdByMachine,
        qaQ.data?.latestByMachine,
      );
      const tech = techVisitForMachineName(name, qaQ.data?.byLocationKeyTech);
      const cleanWf = cleaningQ.data?.byMachineId?.[id];
      const cleanIso =
        pickLastCleaningIso(row, liveById.get(id)) || String(cleanWf?.lastCleaningAt || '').trim();
      const snapTx = pickLastTransactionTs(row, snapTime);
      const vendonTx = vendonLastTxQ.data?.byMachineId?.[id];
      const vendonTxIso =
        vendonTx?.timestamp != null && Number(vendonTx.timestamp) > 0
          ? new Date(Number(vendonTx.timestamp) * 1000).toISOString()
          : '';
      const lastTxIso = snapTx || vendonTxIso || '';
      const act = resolveLatestOperatorActivity(opActQ.data?.byMachineId?.[id]);
      const att = attendanceQ.data?.byMachineId?.[id];
      const cred = creditsQ.data?.byMachineId?.[id];
      const strike = getStrikeOperatorEmail(row);
      const opName = getOperatorDisplayName(row, att);
      const yoyPct = yoy?.trendPct != null ? Number(yoy.trendPct) : null;
      const severity = severityForRow(row);

      const fields: Record<RedFlagsColumnKey, string> = {
        vendingMachine: name,
        operatingHours: hoursById.get(id) || '—',
        alertType: String(reasons[reasons.length - 1] || '—').replace(/\s+/g, ' ').trim(),
        operator: opName,
        operatorActivity: act
          ? `${act.kindShort} · ${formatKuwaitActivityStamp(act.iso) || formatLastTxCompact(act.iso)}`
          : '—',
        lastTransaction: lastTxIso ? formatLastTxCompact(String(lastTxIso)) : '—',
        dailySales:
          today != null && Number.isFinite(Number(today))
            ? `${formatKwd(Number(today))}${trendPctNum != null ? ` · ${formatSalesTrendPct(trendPctNum)}` : ''}`
            : '—',
        topLowDrinks: (() => {
          const high =
            vendonSales?.topProducts?.[0]?.name || vendonSales?.topProduct?.name || '';
          const low =
            vendonSales?.lowProducts?.[0]?.name || vendonSales?.lowProduct?.name || '';
          if (!high && !low) return '—';
          return `${String(high || '—')} / ${String(low || '—')}`;
        })(),
        mtdSales: mtd != null && Number.isFinite(Number(mtd)) ? formatKwd(Number(mtd)) : '—',
        mtdYoySales:
          yoyPct != null && Number.isFinite(yoyPct)
            ? `${formatKwd(Number(yoy?.aSalesKwd || 0))} · ${formatSalesTrendPct(yoyPct)}`
            : yoy?.aSalesKwd != null
              ? formatKwd(Number(yoy.aSalesKwd))
              : '—',
        dailyTarget: `${targetPct} · rem ${remain} · ${owner}`,
        salesAcceleration: 'SX',
        frequency:
          compareMode === 'yesterday' || compareMode === 'yesterdayVsDayBefore' || compareMode === 'sameWeekdayLw'
            ? `${Number.isFinite(todayHits) ? todayHits : 0} / ${Number.isFinite(yestHits) ? yestHits : 0}`
            : `${Number.isFinite(hw) ? hw : 0} / ${Number.isFinite(lw) ? lw : 0}`,
        downtime: (() => {
          const dt = downtimeQ.data?.byMachineId?.[id];
          if (!dt) return '—';
          const t = Number(dt.todaySec || 0);
          const p = Number(dt.periodSec || 0);
          const label = formatDowntimeTrendLabel(
            dt.trendPct != null && Number.isFinite(Number(dt.trendPct)) ? Number(dt.trendPct) : null,
            t,
            p,
            { compact: true },
          );
          return `${formatDowntimeSec(dt.todaySec)} · ${formatDowntimeSec(dt.periodSec)}${
            label ? ` · ${label.text}` : ''
          }`;
        })(),
        goCheck: strike ? 'Ready' : '—',
        sendCredit: cred?.credits_sent != null ? String(cred.credits_sent) : '—',
        vendsResolved: cred?.vends_resolved != null ? String(cred.vends_resolved) : '—',
        testCredits: cred?.dispense_tests != null ? String(cred.dispense_tests) : '—',
        lastCleaning: cleanIso ? formatLastTxCompact(cleanIso) : '—',
        qaVisit:
          qa?.score != null
            ? `${Math.round(Number(qa.score))}% · ${qa.lastVisitDate || qa.lastVisitAt || '—'}`
            : qa?.lastVisitDate || qa?.lastVisitAt || '—',
        techVisit: tech?.lastVisitDate || tech?.lastVisitAt || '—',
        callOp: strike || '—',
        callAm: owner !== '—' ? owner : '—',
      };

      const dayMode =
        compareMode === 'yesterday' ||
        compareMode === 'yesterdayVsDayBefore' ||
        compareMode === 'sameWeekdayLw';

      const stacks: Partial<Record<RedFlagsColumnKey, V2MetricItem[]>> = {
        topLowDrinks: [
          {
            label: 'Top',
            value: String(
              vendonSales?.topProducts?.[0]?.name || vendonSales?.topProduct?.name || '—',
            ).slice(0, 28),
            tone: 'teal',
          },
          {
            label: 'Low',
            value: String(
              vendonSales?.lowProducts?.[0]?.name || vendonSales?.lowProduct?.name || '—',
            ).slice(0, 28),
            tone: 'muted',
          },
        ],
        dailySales: [
          {
            label: salesPair.primaryLabel || 'Primary',
            value: today != null && Number.isFinite(Number(today)) ? formatKwd(Number(today)) : '—',
            tone: 'teal',
          },
          {
            label: 'Trend',
            value: trendPctNum != null && Number.isFinite(trendPctNum) ? formatSalesTrendPct(trendPctNum) : '—',
            tone: toneFromPct(trendPctNum),
          },
          ...(yest != null
            ? [
                {
                  label: salesPair.baselineLabel || 'Baseline',
                  value: formatKwd(Number(yest)),
                  tone: 'muted' as V2MetricTone,
                },
              ]
            : []),
        ],
        mtdSales: [
          {
            label: 'MTD',
            value: mtd != null && Number.isFinite(Number(mtd)) ? formatKwd(Number(mtd)) : '—',
            tone: 'teal',
          },
        ],
        mtdYoySales: [
          {
            label: 'This MTD',
            value: yoy?.aSalesKwd != null ? formatKwd(Number(yoy.aSalesKwd)) : '—',
            tone: 'teal',
          },
          {
            label: 'YoY',
            value: yoyPct != null && Number.isFinite(yoyPct) ? formatSalesTrendPct(yoyPct) : '—',
            tone: toneFromPct(yoyPct),
          },
        ],
        dailyTarget: [
          {
            label: 'Achieved',
            value: targetPct,
            tone:
              targetPctNum == null
                ? 'muted'
                : targetPctNum >= 100
                  ? 'up'
                  : targetPctNum >= 70
                    ? 'amber'
                    : 'down',
          },
          { label: 'Remain', value: remain, tone: 'muted' },
          { label: 'Owner', value: owner, tone: 'violet' },
        ],
        salesAcceleration: sxStack(sxQ.data?.byMachineId?.[id]),
        frequency: dayMode
          ? [
              {
                label: 'Today',
                value: String(Number.isFinite(todayHits) ? todayHits : 0),
                tone: primaryHits >= 10 ? 'crit' : primaryHits >= 3 ? 'amber' : 'teal',
              },
              {
                label: 'Yest',
                value: String(Number.isFinite(yestHits) ? yestHits : 0),
                tone: 'muted',
              },
            ]
          : [
              {
                label: 'This week',
                value: String(Number.isFinite(hw) ? hw : 0),
                tone: hw >= 10 ? 'crit' : 'amber',
              },
              {
                label: 'Last week',
                value: String(Number.isFinite(lw) ? lw : 0),
                tone: 'muted',
              },
            ],
        downtime: (() => {
          const dt = downtimeQ.data?.byMachineId?.[id];
          const todayL = downtimeQ.data?.labelToday?.trim() || 'Today';
          const periodL = downtimeQ.data?.labelPeriod?.trim() || 'Period';
          const t = Number(dt?.todaySec || 0);
          const p = Number(dt?.periodSec || 0);
          const label = formatDowntimeTrendLabel(
            dt?.trendPct != null && Number.isFinite(Number(dt.trendPct)) ? Number(dt.trendPct) : null,
            t,
            p,
            { compact: true },
          );
          return [
            {
              label: todayL,
              value: dt ? formatDowntimeSec(dt.todaySec) : '—',
              tone: (dt?.todaySec ?? 0) > 0 ? ('amber' as V2MetricTone) : ('muted' as V2MetricTone),
            },
            {
              label: periodL,
              value: dt ? formatDowntimeSec(dt.periodSec) : '—',
              tone: (dt?.periodSec ?? 0) > 0 ? ('amber' as V2MetricTone) : ('muted' as V2MetricTone),
            },
            {
              label: `vs ${periodL}`,
              value: label?.text ?? '—',
              tone: label?.worse ? ('crit' as V2MetricTone) : label?.better ? ('up' as V2MetricTone) : ('muted' as V2MetricTone),
            },
          ];
        })(),
        lastTransaction: [
          { label: 'Last tx', value: lastTxIso ? formatLastTxCompact(String(lastTxIso)) : '—', tone: 'teal' },
        ],
        operatorActivity: [
          {
            label: act?.kindShort || 'Activity',
            value: act ? formatKuwaitActivityStamp(act.iso) || '—' : '—',
            tone: act ? 'teal' : 'muted',
          },
        ],
        lastCleaning: [
          {
            label: 'Last clean',
            value: cleanIso ? formatLastTxCompact(cleanIso) : '—',
            tone: cleanIso ? 'teal' : 'muted',
          },
        ],
        qaVisit: [
          {
            label: 'Score',
            value: qa?.score != null ? `${Math.round(Number(qa.score))}%` : '—',
            tone:
              qa?.score == null
                ? 'muted'
                : Number(qa.score) >= 85
                  ? 'up'
                  : Number(qa.score) >= 70
                    ? 'amber'
                    : 'down',
          },
          {
            label: 'Visit',
            value: qa?.lastVisitDate || (qa?.lastVisitAt ? formatLastTxCompact(String(qa.lastVisitAt)) : '—'),
            tone: 'muted',
          },
        ],
        sendCredit: [
          { label: 'Credits', value: cred?.credits_sent != null ? String(cred.credits_sent) : '—', tone: 'teal' },
        ],
        testCredits: [
          { label: 'Tests', value: cred?.dispense_tests != null ? String(cred.dispense_tests) : '—', tone: 'amber' },
        ],
        vendsResolved: [
          {
            label: 'Vends',
            value: cred?.vends_resolved != null ? String(cred.vends_resolved) : '—',
            tone: 'flat',
          },
        ],
      };

      out.push({
        id,
        machineName: name,
        severity,
        isNew,
        fields,
        stacks,
        reasons,
        topProducts: Array.isArray(vendonSales?.topProducts)
          ? vendonSales.topProducts
          : vendonSales?.topProduct
            ? [vendonSales.topProduct]
            : null,
        lowProducts: Array.isArray(vendonSales?.lowProducts)
          ? vendonSales.lowProducts
          : vendonSales?.lowProduct
            ? [vendonSales.lowProduct]
            : null,
        distinctDrinksSold: vendonSales?.distinctDrinksSold ?? null,
        productMixCachedAt: vendonSales?.productMixCachedAt ?? null,
      });
    }
    return out;
  }, [
    ranked,
    salesQ.data,
    salesQ.isSuccess,
    vendonSummaryQ.data,
    vendonLabels,
    compareSel,
    compareMode,
    mtdQ.data,
    mtdYoyQ.data,
    sxQ.data,
    downtimeQ.data,
    creditsQ.data,
    opActQ.data,
    qaQ.data,
    liveById,
    ownerById,
    hoursById,
    dailyIncidentsQ.data,
    attendanceQ.data,
    cleaningQ.data,
    vendonLastTxQ.data,
    snapTime,
  ]);

  const machineScope = ranked.length;
  const open = exceptions.length;
  const critical = exceptions.filter((e) => e.severity === 'Critical').length;
  const clear = Math.max(0, machineScope - open);
  const clearPct = machineScope ? (clear / machineScope) * 100 : 0;

  return {
    loading: snapQ.isLoading,
    fetching: snapQ.isFetching,
    error: snapQ.isError ? (snapQ.error as Error).message : snapQ.data?.error || null,
    refetch: () => {
      void snapQ.refetch();
      void salesQ.refetch();
      void vendonSummaryQ.refetch();
      void mtdQ.refetch();
      void mtdYoyQ.refetch();
      void sxQ.refetch();
      void creditsQ.refetch();
      void opActQ.refetch();
      void qaQ.refetch();
      void dailyIncidentsQ.refetch();
      void attendanceQ.refetch();
      void cleaningQ.refetch();
      void vendonLastTxQ.refetch();
    },
    generatedAt: snapQ.data?.generatedAt,
    exceptions,
    machineScope,
    open,
    critical,
    clear,
    clearPct,
    compareMode,
    periodLabel: vendonLabels.primary || vendonSummaryQ.data?.labelA || null,
    periodStart: vendonSummaryQ.data?.dateAStart || null,
    periodEndExclusive: vendonSummaryQ.data?.dateAEnd || null,
  };
}

export function useV2CompareSelection() {
  const [compare, setCompareState] = useState<CompareSelection>(() => initialCompareSelection());
  const setCompare = (next: CompareSelection) => {
    persistCompareSelection(next);
    setCompareState(next);
  };
  return { compare, setCompare };
}
