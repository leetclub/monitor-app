import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';
import {
  filterSnapshotRows,
  getMachineIdRaw,
  pickLastCleaningIso,
  pickLastTransactionTs,
} from '@/features/redflags/redFlagsModel';
import { formatLastTxCompact } from '@/features/redflags/redFlagsFreqUi';
import { formatDowntimeSec, formatDowntimeTrendLabel } from '@/lib/downtimeDisplay';
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
import {
  fetchCleaningWorkflowMapBatched,
  fetchMachineAttendanceMapBatched,
} from '@/lib/leetWorkflowApi';
import {
  initialCompareSelection,
  presetApiQueryString,
} from '@/lib/comparePresetBridge';
import { footfallDisplayForPreset, salesPairForPreset } from '@/lib/presetComparison';
import type { V2MetricItem, V2MetricTone } from '@/features/v2/V2MetricStack';

type VendonLastTransactionsResponse = {
  byMachineId?: Record<string, { timestamp?: number }>;
};

type VendonSalesRow = {
  aSalesKwd?: number | null;
  bSalesKwd?: number | null;
  trendPct?: number | null;
  peakHour?: { hour: number; count: number; label: string } | null;
  peakHourFromYesterday?: boolean;
  topProduct?: { name: string; count: number } | null;
  lowProduct?: { name: string; count: number } | null;
};

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

type MachinesResponse = {
  machines?: Array<{ id?: string; name?: string; vendon_location_owner?: string }>;
  rows?: Array<{ id?: string; name?: string; vendon_location_owner?: string }>;
};

const WIDE = new Set<OverallColumnKey>([
  'salesTrend',
  'mtdSales',
  'mtdYoySales',
  'targetAchieved',
  'downtime',
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

export function useV2OverallData(compare?: CompareSelection) {
  const compareSel = compare ?? initialCompareSelection();

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesResponse>('/api/alert/machines'),
    staleTime: 5 * 60_000,
  });
  const snapQ = useQuery({
    queryKey: ['red-flags-snapshot'],
    queryFn: () =>
      apiGet<{ rows?: RedAlertRow[]; generatedAt?: string; cacheGeneratedAt?: string }>(
        '/api/alert/red-flags/snapshot',
      ),
    staleTime: 45_000,
    refetchInterval: 60_000,
  });
  const salesQ = useQuery({
    queryKey: ['alert-daily-sales-elapsed', compareSel.preset, 'v2-ov'],
    queryFn: () => apiGet<DailySalesElapsedResponse>('/api/alert/overall/daily-sales-elapsed'),
    staleTime: 30_000,
  });
  const vendonSummaryQ = useQuery({
    queryKey: [
      'alert-vendon-sales-summary',
      compareSel.preset,
      compareSel.a.start,
      compareSel.a.end,
      compareSel.b.start,
      compareSel.b.end,
      'v2-ov',
    ],
    queryFn: () =>
      apiGet<{
        labelA?: string | null;
        labelB?: string | null;
        byMachineId?: Record<string, VendonSalesRow>;
      }>(`/api/alert/overall/vendon-sales-summary?${presetApiQueryString(compareSel.preset, compareSel)}`),
    staleTime: 2 * 60_000,
  });
  const downtimeQ = useQuery({
    queryKey: [
      'alert-overall-downtime-summary',
      compareSel.preset,
      compareSel.a.start,
      compareSel.a.end,
      compareSel.b.start,
      compareSel.b.end,
      'v2-ov',
    ],
    queryFn: () =>
      apiGet<import('@/lib/downtimeDisplay').DowntimeSummaryResponse>(
        `/api/alert/overall/downtime-summary?${presetApiQueryString(compareSel.preset, compareSel)}`,
      ),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
  const vendonLastTxQ = useQuery({
    queryKey: ['alert-overall-vendon-last-transactions', 'v2-ov'],
    queryFn: () => apiGet<VendonLastTransactionsResponse>('/api/alert/overall/last-transactions'),
    staleTime: 60_000,
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
      apiGet<{
        machines?: Array<{
          machineId: string;
          lastCleaningAt?: string | null;
          dailyTarget?: number | null;
        }>;
      }>('/api/live-dashboard/snapshot'),
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
    queryKey: [
      'alert-overall-people-footfall',
      compareSel.preset,
      compareSel.a.start,
      compareSel.a.end,
      compareSel.b.start,
      compareSel.b.end,
      'v2-ov',
    ],
    queryFn: () =>
      apiGet<{
        byMachineId?: Record<
          string,
          {
            primaryIn?: number | null;
            baselineIn?: number | null;
            trendPct?: number | null;
            aCount?: number | null;
            bCount?: number | null;
          }
        >;
      }>(`/api/alert/overall/people-footfall?${presetApiQueryString(compareSel.preset, compareSel)}`),
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
    queryKey: ['leet-workflow-attendance-map', machineIdsKey, 'v2-ov'],
    queryFn: () => fetchMachineAttendanceMapBatched(machineIdsKey.split(',').filter(Boolean)),
    enabled: Boolean(machineIdsKey),
    staleTime: 90_000,
  });

  const cleaningQ = useQuery({
    queryKey: ['leet-workflow-cleaning-map', machineIdsKey, 'v2-ov'],
    queryFn: () => fetchCleaningWorkflowMapBatched(machineIdsKey.split(',').filter(Boolean)),
    enabled: Boolean(machineIdsKey),
    staleTime: 90_000,
  });

  const snapTime = snapQ.data?.generatedAt || snapQ.data?.cacheGeneratedAt || null;

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
    const m = new Map<string, { lastCleaningAt: string | null; dailyTarget: number | null }>();
    for (const row of liveQ.data?.machines || []) {
      const id = String(row.machineId || '').trim();
      if (id) {
        m.set(id, {
          lastCleaningAt: row.lastCleaningAt ?? null,
          dailyTarget: row.dailyTarget != null ? Number(row.dailyTarget) : null,
        });
      }
    }
    return m;
  }, [liveQ.data?.machines]);

  const vendonLabels = useMemo(
    () => ({
      primary: vendonSummaryQ.data?.labelA?.trim() || undefined,
      baseline: vendonSummaryQ.data?.labelB?.trim() || undefined,
    }),
    [vendonSummaryQ.data?.labelA, vendonSummaryQ.data?.labelB],
  );

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
      const vendon = vendonSummaryQ.data?.byMachineId?.[m.id];
      const salesPair = salesPairForPreset(
        compareSel.preset,
        sales,
        compareSel,
        vendon,
        vendonLabels,
      );
      const today = salesPair.primary ?? sales?.todayKwd;
      const trendPctNum =
        salesPair.trendPct != null && Number.isFinite(Number(salesPair.trendPct))
          ? Number(salesPair.trendPct)
          : sales?.trendPct != null
            ? Number(sales.trendPct)
            : null;
      const mtd = mtdQ.data?.byMachineId?.[m.id]?.aSalesKwd;
      const yoy = mtdYoyQ.data?.byMachineId?.[m.id];
      const live = liveById.get(m.id);
      const dailyTarget =
        live?.dailyTarget != null && Number.isFinite(live.dailyTarget) && live.dailyTarget > 0
          ? live.dailyTarget
          : snap?.dailyTarget != null
            ? Number(snap.dailyTarget)
            : NaN;
      const targetPctNum =
        Number.isFinite(dailyTarget) && dailyTarget > 0 && today != null && Number.isFinite(Number(today))
          ? (Number(today) / dailyTarget) * 100
          : null;
      const targetPct = targetPctNum != null ? `${targetPctNum.toFixed(0)}%` : '—';
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
      const cleanWf = cleaningQ.data?.byMachineId?.[m.id];
      const cleanIso =
        pickLastCleaningIso(snap || {}, live?.lastCleaningAt) ||
        String(cleanWf?.lastCleaningAt || '').trim();
      const snapTx = pickLastTransactionTs(snap || {}, snapTime);
      const vendonTx = vendonLastTxQ.data?.byMachineId?.[m.id];
      const vendonTxIso =
        vendonTx?.timestamp != null && Number(vendonTx.timestamp) > 0
          ? new Date(Number(vendonTx.timestamp) * 1000).toISOString()
          : '';
      const lastTx = snapTx || vendonTxIso || '';
      const qa = qaVisitForMachineName(
        m.name,
        qaQ.data?.byLocationKey,
        qaQ.data?.adminSummaryMtdByMachine,
        qaQ.data?.latestByMachine,
      );
      const tech = techVisitForMachineName(m.name, qaQ.data?.byLocationKeyTech);
      const waste = wasteQ.data?.byMachineId?.[m.id]?.wastePct;
      const foot = footQ.data?.byMachineId?.[m.id];
      const footPair = footfallDisplayForPreset(
        compareSel.preset,
        foot?.primaryIn != null || foot?.baselineIn != null
          ? foot
          : {
              primaryIn: foot?.aCount,
              baselineIn: foot?.bCount,
              trendPct: foot?.trendPct,
            },
        {
          todayIn: foot?.aCount ?? foot?.primaryIn,
          yesterdayIn: foot?.bCount ?? foot?.baselineIn,
          trendPct: foot?.trendPct,
        },
      );
      const footPct = footPair.trendPct != null ? Number(footPair.trendPct) : null;
      const reasons = snap?.reasons || [];
      const vendFail = snapshotVendFailSummary(snap);
      const peakLabel = vendon?.peakHour?.label || '';
      const topProduct = vendon?.topProduct?.name || '';
      const lowProduct = vendon?.lowProduct?.name || '';
      const yoyPct = yoy?.trendPct != null ? Number(yoy.trendPct) : null;

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
        lastVendFailed: vendFail || '—',
        downtime: (() => {
          const dt = downtimeQ.data?.byMachineId?.[m.id];
          if (!dt) return '—';
          const t = Number(dt.todaySec || 0);
          const p = Number(dt.periodSec || 0);
          const label = formatDowntimeTrendLabel(
            dt.trendPct != null && Number.isFinite(Number(dt.trendPct)) ? Number(dt.trendPct) : null,
            t,
            p,
          );
          return `${formatDowntimeSec(dt.todaySec)} · ${formatDowntimeSec(dt.periodSec)}${
            label ? ` · ${label.text}` : ''
          }`;
        })(),
        salesTrend:
          today != null && Number.isFinite(Number(today))
            ? `${formatKwd(Number(today))}${trendPctNum != null ? ` · ${formatSalesTrendPct(trendPctNum)}` : ''}`
            : '—',
        mtdSales: mtd != null && Number.isFinite(Number(mtd)) ? formatKwd(Number(mtd)) : '—',
        mtdYoySales:
          yoyPct != null && Number.isFinite(yoyPct)
            ? `${formatKwd(Number(yoy?.aSalesKwd || 0))} · ${formatSalesTrendPct(yoyPct)}`
            : yoy?.aSalesKwd != null
              ? formatKwd(Number(yoy.aSalesKwd))
              : '—',
        targetAchieved: targetPct,
        peakHours: peakLabel
          ? `${peakLabel}${vendon?.peakHour?.count != null ? ` · ${vendon.peakHour.count}` : ''}`
          : '—',
        promotion: '—',
        highestProduct: topProduct || '—',
        lowestProduct: lowProduct || '—',
        peopleCount:
          footPair.primary != null
            ? `${footPair.primary}${footPct != null ? ` · ${formatSalesTrendPct(footPct)}` : ''}`
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
        downtime: (() => {
          const dt = downtimeQ.data?.byMachineId?.[m.id];
          const todayL = downtimeQ.data?.labelToday?.trim() || 'Today';
          const periodL = downtimeQ.data?.labelPeriod?.trim() || 'Period';
          const t = Number(dt?.todaySec || 0);
          const p = Number(dt?.periodSec || 0);
          const label = formatDowntimeTrendLabel(
            dt?.trendPct != null && Number.isFinite(Number(dt.trendPct)) ? Number(dt.trendPct) : null,
            t,
            p,
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
        salesTrend: [
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
            value: footPair.primary != null ? String(footPair.primary) : '—',
            tone: 'teal',
          },
          {
            label: 'Trend',
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
        lastVendFailed: vendFail
          ? [{ label: 'Fails', value: vendFail, tone: 'crit' }]
          : undefined,
        peakHours: peakLabel
          ? [
              {
                label: vendon?.peakHourFromYesterday ? 'Yest peak' : 'Peak',
                value: peakLabel,
                tone: 'teal',
              },
            ]
          : undefined,
        highestProduct: topProduct
          ? [{ label: 'Top SKU', value: topProduct, tone: 'teal' }]
          : undefined,
        lowestProduct: lowProduct
          ? [{ label: 'Low SKU', value: lowProduct, tone: 'amber' }]
          : undefined,
      };

      out.push({ id: m.id, name: m.name, flagged: flagged.has(m.id), fields, stacks });
    }
    return out;
  }, [
    machines,
    snapById,
    salesQ.data,
    salesQ.isSuccess,
    vendonSummaryQ.data,
    downtimeQ.data,
    vendonLabels,
    compareSel,
    mtdQ.data,
    mtdYoyQ.data,
    qaQ.data,
    liveById,
    profById,
    opActQ.data,
    attQ.data,
    cleaningQ.data,
    wasteQ.data,
    footQ.data,
    vendonLastTxQ.data,
    snapTime,
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
      void vendonSummaryQ.refetch();
      void vendonLastTxQ.refetch();
      void mtdQ.refetch();
      void mtdYoyQ.refetch();
      void qaQ.refetch();
      void footQ.refetch();
      void attQ.refetch();
      void cleaningQ.refetch();
    },
    rows,
    machineCount: machines.length,
    operational,
    flagged: flagged.size,
    uptime,
  };
}
