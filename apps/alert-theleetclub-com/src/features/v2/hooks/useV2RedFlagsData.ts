import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import {
  filterSnapshotRows,
  getMachineIdRaw,
  getOperatorDisplayName,
  getStrikeOperatorEmail,
  pickLastCleaningIso,
  rankRows,
} from '@/features/redflags/redFlagsModel';
import {
  formatKwd,
  formatSalesTrendPct,
  salesDayKwd,
  salesElapsedForMachine,
  type DailySalesElapsedResponse,
} from '@/lib/salesDisplay';
import { formatLastTxCompact } from '@/features/redflags/redFlagsFreqUi';
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
import type { V2MetricItem, V2MetricTone } from '@/features/v2/V2MetricStack';

type Snapshot = { rows?: RedAlertRow[]; error?: string; generatedAt?: string };
type CreditsTotals = {
  byMachineId?: Record<
    string,
    { credits_sent?: number; dispense_tests?: number; vends_resolved?: string }
  >;
};

const WIDE_COLS = new Set<RedFlagsColumnKey>([
  'dailySales',
  'mtdSales',
  'mtdYoySales',
  'dailyTarget',
  'salesAcceleration',
  'frequency',
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
  /** Manus display values keyed by Classic workbook column. */
  fields: Record<RedFlagsColumnKey, string>;
  /** Manus metric stacks for trend-style cells. */
  stacks: Partial<Record<RedFlagsColumnKey, V2MetricItem[]>>;
  reasons: string[];
};

function isCritical(row: RedAlertRow): boolean {
  const tier = Number(row.alertPriorityTier);
  if (Number.isFinite(tier) && tier <= 0) return true;
  const blob = (row.reasons || []).join(' ').toLowerCase();
  return /offline|power.?off|\boff\b|dispense|critical|stale.?sale|no.?sale/i.test(blob);
}

function toneFromPct(pct: number | null | undefined): V2MetricTone {
  if (pct == null || !Number.isFinite(pct)) return 'muted';
  if (pct > 0.5) return 'up';
  if (pct < -0.5) return 'down';
  return 'flat';
}

function sxStack(sx?: SxAccelerationRow | null): V2MetricItem[] {
  const loc = sx?.location?.sxPct;
  const prod = sx?.product?.sxPct;
  return [
    {
      label: 'Loc SX',
      value: loc != null && Number.isFinite(Number(loc)) ? formatSalesTrendPct(Number(loc)).replace(/%$/, ' pts') : '—',
      tone: toneFromPct(loc != null ? Number(loc) : null),
    },
    {
      label: 'Prod SX',
      value: prod != null && Number.isFinite(Number(prod)) ? formatSalesTrendPct(Number(prod)).replace(/%$/, ' pts') : '—',
      tone: toneFromPct(prod != null ? Number(prod) : null),
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

export function useV2RedFlagsData() {
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
    queryKey: ['alert-daily-sales-elapsed', 'v2-full'],
    queryFn: () => apiGet<DailySalesElapsedResponse>('/api/alert/overall/daily-sales-elapsed'),
    enabled: snapQ.isFetched,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const mtdQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd', 'v2-full'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { aSalesKwd?: number | null }> }>(
        '/api/alert/overall/vendon-sales-summary?preset=mtd_vs_mtd',
      ),
    enabled: snapQ.isFetched,
    staleTime: 2 * 60_000,
  });

  const mtdYoyQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd-yoy', 'v2-full'],
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
    queryKey: ['alert-sales-acceleration', 'v2-full'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, SxAccelerationRow> }>(
        '/api/alert/overall/sales-acceleration?preset=today_vs_yesterday',
      ),
    enabled: snapQ.isFetched,
    staleTime: 2 * 60_000,
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
    queryKey: ['alert-qa-summary', 'v2-full'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    enabled: snapQ.isFetched,
    staleTime: 60_000,
  });

  const liveQ = useQuery({
    queryKey: ['live-dashboard-snapshot', 'v2-full'],
    queryFn: () =>
      apiGet<{ machines?: Array<{ machineId: string; lastCleaningAt?: string | null }> }>(
        '/api/live-dashboard/snapshot',
      ),
    enabled: snapQ.isFetched,
    staleTime: 30_000,
  });

  const profilesQ = useQuery({
    queryKey: ['alert-overall-admin-profiles', 'v2-full'],
    queryFn: () =>
      apiGet<{ rows?: { machine_id?: string; machine_name?: string; location_owner?: string | null }[] }>(
        '/api/alert/overall/admin-profiles',
      ),
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

  const ranked = useMemo(() => {
    const rows = filterSnapshotRows(snapQ.data?.rows || []);
    return rankRows(rows, {}, 'week');
  }, [snapQ.data?.rows]);

  const exceptions = useMemo(() => {
    const out: V2ExceptionRow[] = [];
    for (const { row, isNew } of ranked) {
      const reasons = row.reasons || [];
      if (!reasons.length) continue;
      const id = getMachineIdRaw(row);
      if (!id) continue;
      const name = String(row.machineName || id);
      const sales = salesElapsedForMachine(salesQ.data, id, salesQ.isSuccess);
      const today = sales?.todayKwd;
      const yest = salesDayKwd(sales, 1);
      const mtd = mtdQ.data?.byMachineId?.[id]?.aSalesKwd;
      const yoy = mtdYoyQ.data?.byMachineId?.[id];
      const dailyTarget = row.dailyTarget != null ? Number(row.dailyTarget) : NaN;
      const targetPct =
        Number.isFinite(dailyTarget) && dailyTarget > 0 && today != null && Number.isFinite(Number(today))
          ? `${((Number(today) / dailyTarget) * 100).toFixed(0)}%`
          : '—';
      const remain =
        Number.isFinite(dailyTarget) && today != null && Number.isFinite(Number(today))
          ? formatKwd(Math.max(0, dailyTarget - Number(today)))
          : '—';
      const owner = ownerById.get(id) || '—';
      const hw = Number(row.happensWeek ?? row.frequency?.totalCriteriaHitsThisWeek ?? 0);
      const lw = Number(row.happenedLastWeek ?? row.frequency?.totalCriteriaHitsLastWeek ?? 0);
      const trend =
        sales?.trendPct != null && Number.isFinite(Number(sales.trendPct))
          ? formatSalesTrendPct(Number(sales.trendPct))
          : '—';
      const qa = qaVisitForMachineName(
        name,
        qaQ.data?.byLocationKey,
        qaQ.data?.adminSummaryMtdByMachine,
        qaQ.data?.latestByMachine,
      );
      const tech = techVisitForMachineName(name, qaQ.data?.byLocationKeyTech);
      const cleanIso = pickLastCleaningIso(row, liveById.get(id));
      const lastTxIso =
        row.lastTransactionAtUtc ||
        row.last_transaction_at_utc ||
        row.lastSaleAtUtc ||
        row.last_sale_at_utc ||
        '';
      const act = resolveLatestOperatorActivity(opActQ.data?.byMachineId?.[id]);
      const cred = creditsQ.data?.byMachineId?.[id];
      const strike = getStrikeOperatorEmail(row);
      const opName = getOperatorDisplayName(row);

      const trendPctNum = sales?.trendPct != null ? Number(sales.trendPct) : null;
      const yoyPct = yoy?.trendPct != null ? Number(yoy.trendPct) : null;
      const targetPctNum =
        Number.isFinite(dailyTarget) && dailyTarget > 0 && today != null && Number.isFinite(Number(today))
          ? (Number(today) / dailyTarget) * 100
          : null;

      const fields: Record<RedFlagsColumnKey, string> = {
        vendingMachine: name,
        alertType: String(reasons[reasons.length - 1] || '—').replace(/\s+/g, ' ').trim(),
        operator: opName,
        operatorActivity: act
          ? `${act.kindShort} · ${formatKuwaitActivityStamp(act.iso) || formatLastTxCompact(act.iso)}`
          : '—',
        lastTransaction: lastTxIso ? formatLastTxCompact(String(lastTxIso)) : '—',
        dailySales:
          today != null && Number.isFinite(Number(today))
            ? `${formatKwd(Number(today))}${yest != null ? ` · ${trend}` : ''}`
            : '—',
        mtdSales: mtd != null && Number.isFinite(Number(mtd)) ? formatKwd(Number(mtd)) : '—',
        mtdYoySales:
          yoyPct != null && Number.isFinite(yoyPct)
            ? `${formatKwd(Number(yoy?.aSalesKwd || 0))} · ${formatSalesTrendPct(yoyPct)}`
            : yoy?.aSalesKwd != null
              ? formatKwd(Number(yoy.aSalesKwd))
              : '—',
        dailyTarget: `${targetPct} · rem ${remain} · ${owner}`,
        salesAcceleration: 'SX',
        frequency: `${Number.isFinite(hw) ? hw : 0} / ${Number.isFinite(lw) ? lw : 0}`,
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

      const stacks: Partial<Record<RedFlagsColumnKey, V2MetricItem[]>> = {
        dailySales: [
          {
            label: 'Today',
            value: today != null && Number.isFinite(Number(today)) ? formatKwd(Number(today)) : '—',
            tone: 'teal',
          },
          {
            label: 'Trend',
            value: trendPctNum != null && Number.isFinite(trendPctNum) ? formatSalesTrendPct(trendPctNum) : '—',
            tone: toneFromPct(trendPctNum),
          },
          ...(yest != null
            ? [{ label: 'Yest', value: formatKwd(Number(yest)), tone: 'muted' as V2MetricTone }]
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
        frequency: [
          { label: 'This week', value: String(Number.isFinite(hw) ? hw : 0), tone: hw >= 10 ? 'crit' : 'amber' },
          { label: 'Last week', value: String(Number.isFinite(lw) ? lw : 0), tone: 'muted' },
        ],
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
          { label: 'Last clean', value: cleanIso ? formatLastTxCompact(cleanIso) : '—', tone: cleanIso ? 'teal' : 'muted' },
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
        severity: isCritical(row) ? 'Critical' : 'Watch',
        isNew,
        fields,
        stacks,
        reasons,
      });
    }
    return out;
  }, [
    ranked,
    salesQ.data,
    salesQ.isSuccess,
    mtdQ.data,
    mtdYoyQ.data,
    sxQ.data,
    creditsQ.data,
    opActQ.data,
    qaQ.data,
    liveById,
    ownerById,
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
      void mtdQ.refetch();
      void mtdYoyQ.refetch();
      void sxQ.refetch();
      void creditsQ.refetch();
      void opActQ.refetch();
      void qaQ.refetch();
    },
    generatedAt: snapQ.data?.generatedAt,
    exceptions,
    machineScope,
    open,
    critical,
    clear,
    clearPct,
  };
}
