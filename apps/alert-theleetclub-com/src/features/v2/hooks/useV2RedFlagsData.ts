import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import {
  filterSnapshotRows,
  getMachineIdRaw,
  getOperatorDisplayName,
  pickLastCleaningIso,
  rankRows,
} from '@/features/redflags/redFlagsModel';
import {
  formatKwd,
  salesElapsedForMachine,
  type DailySalesElapsedResponse,
} from '@/lib/salesDisplay';
import { formatLastTxCompact } from '@/features/redflags/redFlagsFreqUi';
import { qaVisitForMachineName, type QaSummaryResponse } from '@/lib/qaVisitDisplay';

type Snapshot = { rows?: RedAlertRow[]; error?: string; generatedAt?: string };

export type V2ExceptionRow = {
  id: string;
  machineName: string;
  location: string;
  operator: string;
  severity: 'Critical' | 'Watch';
  reasons: string[];
  alertType: string;
  lastTx: string;
  dailySales: string;
  mtdSales: string;
  target: string;
  frequency: string;
  lastCleaning: string;
  qaScore: string;
  isNew: boolean;
};

function isCritical(row: RedAlertRow): boolean {
  const tier = Number(row.alertPriorityTier);
  if (Number.isFinite(tier) && tier <= 0) return true;
  const blob = (row.reasons || []).join(' ').toLowerCase();
  return /offline|power.?off|\boff\b|dispense|critical|stale.?sale|no.?sale/i.test(blob);
}

export function useV2RedFlagsData() {
  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<Snapshot>('/api/alert/red-flags/snapshot'),
    staleTime: 45_000,
    refetchInterval: 60_000,
  });

  const salesQ = useQuery({
    queryKey: ['alert-daily-sales-elapsed', 'v2-manus'],
    queryFn: () => apiGet<DailySalesElapsedResponse>('/api/alert/overall/daily-sales-elapsed'),
    enabled: snapQ.isFetched,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const mtdQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd', 'v2-manus'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { aSalesKwd?: number | null }> }>(
        '/api/alert/overall/vendon-sales-summary?preset=mtd_vs_mtd',
      ),
    enabled: snapQ.isFetched,
    staleTime: 2 * 60_000,
  });

  const qaQ = useQuery({
    queryKey: ['alert-qa-summary', 'v2-manus'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    enabled: snapQ.isFetched,
    staleTime: 60_000,
  });

  const liveQ = useQuery({
    queryKey: ['live-dashboard-snapshot', 'v2-manus'],
    queryFn: () =>
      apiGet<{ machines?: Array<{ machineId: string; lastCleaningAt?: string | null }> }>(
        '/api/live-dashboard/snapshot',
      ),
    enabled: snapQ.isFetched,
    staleTime: 30_000,
  });

  const liveById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const row of liveQ.data?.machines || []) {
      const id = String(row.machineId || '').trim();
      if (id) m.set(id, row.lastCleaningAt ?? null);
    }
    return m;
  }, [liveQ.data?.machines]);

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
      const sales = salesElapsedForMachine(salesQ.data, id, salesQ.isSuccess);
      const today = sales?.todayKwd;
      const mtd = mtdQ.data?.byMachineId?.[id]?.aSalesKwd;
      const dailyTarget = row.dailyTarget != null ? Number(row.dailyTarget) : NaN;
      const pct =
        Number.isFinite(dailyTarget) && dailyTarget > 0 && today != null && Number.isFinite(today)
          ? `${((Number(today) / dailyTarget) * 100).toFixed(0)}%`
          : '—';
      const hw = Number(row.happensWeek ?? row.frequency?.totalCriteriaHitsThisWeek ?? 0);
      const lw = Number(row.happenedLastWeek ?? row.frequency?.totalCriteriaHitsLastWeek ?? 0);
      const qa = qaVisitForMachineName(
        String(row.machineName || id),
        qaQ.data?.byLocationKey,
        qaQ.data?.adminSummaryMtdByMachine,
        qaQ.data?.latestByMachine,
      );
      const cleanIso = pickLastCleaningIso(row, liveById.get(id));
      const lastTxIso =
        row.lastTransactionAtUtc ||
        row.last_transaction_at_utc ||
        row.lastSaleAtUtc ||
        row.last_sale_at_utc ||
        '';
      out.push({
        id,
        machineName: String(row.machineName || id),
        location: String(row.machineLocation || '—'),
        operator: getOperatorDisplayName(row) || '—',
        severity: isCritical(row) ? 'Critical' : 'Watch',
        reasons,
        alertType: String(reasons[reasons.length - 1] || '—').replace(/\s+/g, ' ').trim(),
        lastTx: lastTxIso ? formatLastTxCompact(String(lastTxIso)) : '—',
        dailySales: today != null && Number.isFinite(Number(today)) ? formatKwd(Number(today)) : '—',
        mtdSales: mtd != null && Number.isFinite(Number(mtd)) ? formatKwd(Number(mtd)) : '—',
        target: pct,
        frequency: `${Number.isFinite(hw) ? hw : 0}/${Number.isFinite(lw) ? lw : 0}`,
        lastCleaning: cleanIso ? formatLastTxCompact(cleanIso) : '—',
        qaScore: qa?.score != null ? String(qa.score) : '—',
        isNew,
      });
    }
    return out;
  }, [ranked, salesQ.data, salesQ.isSuccess, mtdQ.data, qaQ.data, liveById]);

  const machineScope = ranked.length;
  const open = exceptions.length;
  const critical = exceptions.filter((e) => e.severity === 'Critical').length;
  const clear = Math.max(0, machineScope - open);
  const clearPct = machineScope ? (clear / machineScope) * 100 : 0;

  return {
    loading: snapQ.isLoading,
    fetching: snapQ.isFetching,
    error: snapQ.isError ? (snapQ.error as Error).message : snapQ.data?.error || null,
    refetch: () => void snapQ.refetch(),
    generatedAt: snapQ.data?.generatedAt,
    exceptions,
    machineScope,
    open,
    critical,
    clear,
    clearPct,
  };
}
