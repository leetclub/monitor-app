import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import { filterSnapshotRows, getMachineIdRaw, pickLastCleaningIso } from '@/features/redflags/redFlagsModel';
import { formatLastTxCompact } from '@/features/redflags/redFlagsFreqUi';
import {
  formatKwd,
  formatSalesTrendPct,
  salesElapsedForMachine,
  type DailySalesElapsedResponse,
} from '@/lib/salesDisplay';
import {
  qaVisitForMachineName,
  techVisitForMachineName,
  type QaSummaryResponse,
} from '@/lib/qaVisitDisplay';
import {
  resolveLatestOperatorActivity,
  type OperatorActivityTimes,
} from '@/components/OperatorActivityCell';
import { formatKuwaitActivityStamp } from '@/lib/formatKuwait';
import { OVERALL_XLSX_ORDER, type OverallColumnKey } from '@/features/overall/overallWorkbookColumns';
import { OVERALL_TABLE_HEADERS } from '@/lib/tableHeaderLabels';
import { fetchMachineAttendanceMapBatched } from '@/lib/leetWorkflowApi';
import type { V2MetricItem, V2MetricTone } from '@/features/v2/V2MetricStack';

type MachinesResponse = {
  machines?: Array<{ id?: string; name?: string; vendon_location_owner?: string }>;
  rows?: Array<{ id?: string; name?: string; vendon_location_owner?: string }>;
};

const WIDE = new Set<OverallColumnKey>([
  'salesTrend',
  'mtdSales',
  'mtdYoySales',
  'targetAchieved',
  'peopleCount',
  'lastQaCheck',
  'lastTechCheck',
  'operatorActivity',
  'lastTransaction',
  'lastCleaned',
  'attendance',
  'wastagePct',
]);

export type V2OverallRow = {
  id: string;
  name: string;
  flagged: boolean;
  fields: Record<OverallColumnKey, string>;
  stacks: Partial<Record<OverallColumnKey, V2MetricItem[]>>;
};

function toneFromPct(pct: number | null | undefined): V2MetricTone {
  if (pct == null || !Number.isFinite(pct)) return 'muted';
  if (pct > 0.5) return 'up';
  if (pct < -0.5) return 'down';
  return 'flat';
}

export const V2_OVERALL_COLUMNS = OVERALL_XLSX_ORDER.map((key) => ({
  key,
  label: OVERALL_TABLE_HEADERS[key].main,
  sub: OVERALL_TABLE_HEADERS[key].sub,
  sticky: key === 'vendingMachine',
  wide: WIDE.has(key),
}));

export function useV2OverallData() {
  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    staleTime: 5 * 60_000,
  });
  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () => apiGet<{ rows?: RedAlertRow[]; generatedAt?: string }>('/api/alert/red-flags/snapshot'),
    staleTime: 45_000,
    refetchInterval: 60_000,
  });
  const salesQ = useQuery({
    queryKey: ['alert-daily-sales-elapsed', 'v2-ov'],
    queryFn: () => apiGet<DailySalesElapsedResponse>('/api/alert/overall/daily-sales-elapsed'),
    staleTime: 30_000,
  });
  const mtdQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd', 'v2-ov'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { aSalesKwd?: number | null }> }>(
        '/api/alert/overall/vendon-sales-summary?preset=mtd_vs_mtd',
      ),
    staleTime: 2 * 60_000,
  });
  const mtdYoyQ = useQuery({
    queryKey: ['alert-vendon-sales-mtd-yoy', 'v2-ov'],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<string, { aSalesKwd?: number | null; trendPct?: number | null }>;
      }>('/api/alert/overall/vendon-sales-summary?preset=mtd_vs_yoy'),
    staleTime: 2 * 60_000,
  });
  const qaQ = useQuery({
    queryKey: ['alert-qa-summary', 'v2-ov'],
    queryFn: () => apiGet<QaSummaryResponse>('/api/alert/qa/summary'),
    staleTime: 60_000,
  });
  const liveQ = useQuery({
    queryKey: ['live-dashboard-snapshot', 'v2-ov'],
    queryFn: () =>
      apiGet<{ machines?: Array<{ machineId: string; lastCleaningAt?: string | null }> }>(
        '/api/live-dashboard/snapshot',
      ),
    staleTime: 30_000,
  });
  const profilesQ = useQuery({
    queryKey: ['alert-overall-admin-profiles', 'v2-ov'],
    queryFn: () =>
      apiGet<{
        rows?: Array<{
          machine_id?: string;
          operator_name?: string | null;
          location_hours?: string | null;
          location_owner?: string | null;
        }>;
      }>('/api/alert/overall/admin-profiles'),
    staleTime: 5 * 60_000,
  });
  const wasteQ = useQuery({
    queryKey: ['alert-overall-waste', 'v2-ov'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { wastePct?: number | null }> }>(
        '/api/alert/overall/waste-by-machine',
      ),
    staleTime: 5 * 60_000,
  });
  const footQ = useQuery({
    queryKey: ['alert-overall-footfall', 'v2-ov'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, { aCount?: number | null; trendPct?: number | null }> }>(
        '/api/alert/overall/people-footfall?preset=today_vs_yesterday',
      ),
    staleTime: 5 * 60_000,
  });

  const machines = useMemo(() => {
    const raw = machinesQ.data?.machines || machinesQ.data?.rows || [];
    if (raw.length) {
      return raw
        .map((m) => ({ id: String(m.id || ''), name: String(m.name || m.id || '') }))
        .filter((m) => m.id)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    for (const r of snapQ.data?.rows || []) {
      const id = getMachineIdRaw(r);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: String(r.machineName || id) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [machinesQ.data, snapQ.data?.rows]);

  const machineIdsKey = useMemo(() => machines.map((m) => m.id).join(','), [machines]);

  const opActQ = useQuery({
    queryKey: ['alert-operator-activity', machineIdsKey, 'v2-ov'],
    queryFn: () =>
      apiGet<{ byMachineId?: Record<string, OperatorActivityTimes> }>(
        machineIdsKey
          ? `/api/alert/operator-activity?machines=${encodeURIComponent(machineIdsKey)}`
          : '/api/alert/operator-activity',
      ),
    enabled: Boolean(machineIdsKey),
    staleTime: 90_000,
  });

  const attQ = useQuery({
    queryKey: ['alert-workflow-attendance', machineIdsKey, 'v2-ov'],
    queryFn: () => fetchMachineAttendanceMapBatched(machineIdsKey.split(',').filter(Boolean)),
    enabled: Boolean(machineIdsKey),
    staleTime: 90_000,
  });

  const snapById = useMemo(() => {
    const m = new Map<string, RedAlertRow>();
    for (const r of snapQ.data?.rows || []) {
      const id = getMachineIdRaw(r);
      if (id) m.set(id, r);
    }
    return m;
  }, [snapQ.data?.rows]);

  const flagged = useMemo(() => {
    const set = new Set<string>();
    for (const r of filterSnapshotRows(snapQ.data?.rows || [])) {
      if ((r.reasons || []).length) set.add(getMachineIdRaw(r));
    }
    return set;
  }, [snapQ.data?.rows]);

  const liveById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const row of liveQ.data?.machines || []) {
      const id = String(row.machineId || '').trim();
      if (id) m.set(id, row.lastCleaningAt ?? null);
    }
    return m;
  }, [liveQ.data?.machines]);

  const profById = useMemo(() => {
    const m = new Map<string, { operator?: string; hours?: string; owner?: string }>();
    for (const r of profilesQ.data?.rows || []) {
      const id = String(r.machine_id || '').trim();
      if (!id) continue;
      m.set(id, {
        operator: String(r.operator_name || '').trim() || undefined,
        hours: String(r.location_hours || '').trim() || undefined,
        owner: String(r.location_owner || '').trim() || undefined,
      });
    }
    return m;
  }, [profilesQ.data?.rows]);

  const rows = useMemo(() => {
    const out: V2OverallRow[] = [];
    for (const m of machines) {
      const snap = snapById.get(m.id);
      const sales = salesElapsedForMachine(salesQ.data, m.id, salesQ.isSuccess);
      const today = sales?.todayKwd;
      const trend =
        sales?.trendPct != null && Number.isFinite(Number(sales.trendPct))
          ? formatSalesTrendPct(Number(sales.trendPct))
          : '—';
      const mtd = mtdQ.data?.byMachineId?.[m.id]?.aSalesKwd;
      const yoy = mtdYoyQ.data?.byMachineId?.[m.id];
      const dailyTarget = snap?.dailyTarget != null ? Number(snap.dailyTarget) : NaN;
      const targetPct =
        Number.isFinite(dailyTarget) && dailyTarget > 0 && today != null && Number.isFinite(Number(today))
          ? `${((Number(today) / dailyTarget) * 100).toFixed(0)}%`
          : '—';
      const prof = profById.get(m.id);
      const op =
        prof?.operator ||
        String(snap?.operator || snap?.operatorName || snap?.redAlertOperator || '').trim() ||
        '—';
      const act = resolveLatestOperatorActivity(opActQ.data?.byMachineId?.[m.id]);
      const att = attQ.data?.byMachineId?.[m.id];
      const attLabel =
        att?.attendanceStatusLabel || att?.attendanceStatus || att?.pill?.label
          ? `${att.attendanceStatusLabel || att.attendanceStatus || att.pill?.label}${
              att.operatorName ? ` · ${att.operatorName}` : ''
            }`
          : '—';
      const cleanIso = pickLastCleaningIso(snap || {}, liveById.get(m.id));
      const lastTx =
        snap?.lastTransactionAtUtc ||
        snap?.last_transaction_at_utc ||
        snap?.lastSaleAtUtc ||
        snap?.last_sale_at_utc ||
        '';
      const qa = qaVisitForMachineName(
        m.name,
        qaQ.data?.byLocationKey,
        qaQ.data?.adminSummaryMtdByMachine,
        qaQ.data?.latestByMachine,
      );
      const tech = techVisitForMachineName(m.name, qaQ.data?.byLocationKeyTech);
      const waste = wasteQ.data?.byMachineId?.[m.id]?.wastePct;
      const foot = footQ.data?.byMachineId?.[m.id];
      const reasons = snap?.reasons || [];

      const trendPctNum = sales?.trendPct != null ? Number(sales.trendPct) : null;
      const yoyPct = yoy?.trendPct != null ? Number(yoy.trendPct) : null;
      const targetPctNum =
        Number.isFinite(dailyTarget) && dailyTarget > 0 && today != null && Number.isFinite(Number(today))
          ? (Number(today) / dailyTarget) * 100
          : null;
      const footPct = foot?.trendPct != null ? Number(foot.trendPct) : null;

      const fields: Record<OverallColumnKey, string> = {
        operatingHours: prof?.hours || '—',
        vendingMachine: m.name,
        operator: op,
        operatorActivity: act
          ? `${act.kindShort} · ${formatKuwaitActivityStamp(act.iso)}`
          : '—',
        lastTransaction: lastTx ? formatLastTxCompact(String(lastTx)) : '—',
        attendance: attLabel,
        lastCleaned: cleanIso ? formatLastTxCompact(cleanIso) : '—',
        lastVendFailed: '—',
        salesTrend:
          today != null && Number.isFinite(Number(today))
            ? `${formatKwd(Number(today))} · ${trend}`
            : '—',
        mtdSales: mtd != null && Number.isFinite(Number(mtd)) ? formatKwd(Number(mtd)) : '—',
        mtdYoySales:
          yoyPct != null && Number.isFinite(yoyPct)
            ? `${formatKwd(Number(yoy?.aSalesKwd || 0))} · ${formatSalesTrendPct(yoyPct)}`
            : yoy?.aSalesKwd != null
              ? formatKwd(Number(yoy.aSalesKwd))
              : '—',
        targetAchieved: targetPct,
        peakHours: '—',
        promotion: '—',
        highestProduct: '—',
        lowestProduct: '—',
        peopleCount:
          foot?.aCount != null
            ? `${foot.aCount}${footPct != null ? ` · ${formatSalesTrendPct(footPct)}` : ''}`
            : '—',
        customerCalls: '—',
        mostIssue: reasons[0] || '—',
        lastQaCheck:
          qa?.score != null
            ? `${Math.round(Number(qa.score))}% · ${qa.lastVisitDate || qa.lastVisitAt || '—'}`
            : qa?.lastVisitDate || qa?.lastVisitAt || '—',
        lastTechCheck: tech?.lastVisitDate || tech?.lastVisitAt || '—',
        wastagePct: waste != null && Number.isFinite(Number(waste)) ? `${Number(waste).toFixed(1)}%` : '—',
        promotionRuns: '—',
      };

      const stacks: Partial<Record<OverallColumnKey, V2MetricItem[]>> = {
        salesTrend: [
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
        targetAchieved: [
          {
            label: 'Target',
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
        ],
        peopleCount: [
          {
            label: 'Footfall',
            value: foot?.aCount != null ? String(foot.aCount) : '—',
            tone: 'teal',
          },
          {
            label: 'vs yest',
            value: footPct != null && Number.isFinite(footPct) ? formatSalesTrendPct(footPct) : '—',
            tone: toneFromPct(footPct),
          },
        ],
        lastQaCheck: [
          {
            label: 'QA',
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
            label: 'When',
            value: qa?.lastVisitDate || '—',
            tone: 'muted',
          },
        ],
        lastTechCheck: [
          { label: 'Tech', value: tech?.lastVisitDate || tech?.lastVisitAt || '—', tone: 'muted' },
        ],
        operatorActivity: [
          {
            label: act?.kindShort || 'Activity',
            value: act ? formatKuwaitActivityStamp(act.iso) : '—',
            tone: act ? 'teal' : 'muted',
          },
        ],
        lastTransaction: [
          { label: 'Last tx', value: lastTx ? formatLastTxCompact(String(lastTx)) : '—', tone: 'teal' },
        ],
        lastCleaned: [
          { label: 'Clean', value: cleanIso ? formatLastTxCompact(cleanIso) : '—', tone: cleanIso ? 'teal' : 'muted' },
        ],
        attendance: [{ label: 'Shift', value: attLabel, tone: attLabel !== '—' ? 'amber' : 'muted' }],
        wastagePct: [
          {
            label: 'Waste',
            value: waste != null && Number.isFinite(Number(waste)) ? `${Number(waste).toFixed(1)}%` : '—',
            tone: waste != null && Number(waste) > 5 ? 'down' : 'flat',
          },
        ],
      };

      out.push({ id: m.id, name: m.name, flagged: flagged.has(m.id), fields, stacks });
    }
    return out;
  }, [
    machines,
    snapById,
    salesQ.data,
    salesQ.isSuccess,
    mtdQ.data,
    mtdYoyQ.data,
    qaQ.data,
    liveById,
    profById,
    opActQ.data,
    attQ.data,
    wasteQ.data,
    footQ.data,
    flagged,
  ]);

  const operational = Math.max(0, machines.length - flagged.size);
  const uptime = machines.length ? (operational / machines.length) * 100 : 0;

  return {
    loading: machinesQ.isLoading && !machines.length,
    fetching: machinesQ.isFetching || snapQ.isFetching,
    error: machinesQ.isError ? (machinesQ.error as Error).message : null,
    refetch: () => {
      void machinesQ.refetch();
      void snapQ.refetch();
      void salesQ.refetch();
      void qaQ.refetch();
    },
    rows,
    machineCount: machines.length,
    operational,
    flagged: flagged.size,
    uptime,
  };
}
