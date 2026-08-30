import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import * as echarts from 'echarts';
import { createPortal } from 'react-dom';
import { ChartExportButton } from '@/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/lib/chartExport';
import { formatKwd, formatSalesTrendHtml } from '@/lib/salesDisplay';
import { GrowthCompareModal } from '@/features/performance/GrowthCompareModal';
import {
  getAlertModalPortal,
  modalBackdropHandlers,
  modalPanelHandlers,
  useAlertModal,
} from '@/lib/useAlertModal';
import {
  SERIES_PALETTE,
  type FleetMachine,
  type FleetKpis,
  type GrowthGroupKey,
  type PerfDay,
  type PerfPreset,
  type PerfViewMode,
} from '@/features/performance/perfTypes';
import {
  pickLowest5,
  pickTop5,
  shareOfFleetPct,
  sortMachinesBySales,
  sumPeriodKd,
} from '@/features/performance/fleetRanking';

const PRESETS: { id: PerfPreset; label: string }[] = [
  { id: 'this_week', label: 'This week (WTD)' },
  { id: 'last_week', label: 'Last week' },
  { id: 'last_2_weeks', label: 'Last 2 weeks' },
  { id: 'this_month', label: 'This month (MTD)' },
  { id: 'last_month', label: 'Last month' },
];

const FLEET_VIEWS: { id: PerfViewMode; label: string }[] = [
  { id: 'all', label: 'All machines' },
  { id: 'top5', label: 'Top 5' },
  { id: 'lowest5', label: 'Lowest 5' },
];

const GRAPH_PAGE = 12;

function readTheme() {
  const dark =
    typeof document === 'undefined'
      ? true
      : document.documentElement.getAttribute('data-mode') === 'dark' ||
        (document.documentElement.getAttribute('data-mode') !== 'light' &&
          document.documentElement.getAttribute('data-theme') !== 'pro');
  if (!dark) {
    return {
      text: '#0f172a',
      muted: '#64748b',
      grid: 'rgba(15, 23, 42, 0.08)',
      tipBg: 'rgba(15, 41, 66, 0.96)',
      cross: 'rgba(15, 23, 42, 0.35)',
    };
  }
  return {
    text: '#e2e8f0',
    muted: '#94a3b8',
    grid: 'rgba(148, 163, 184, 0.12)',
    tipBg: 'rgba(15, 23, 42, 0.96)',
    cross: 'rgba(226, 232, 240, 0.35)',
  };
}

function dayLabel(d: PerfDay): string {
  const wd = (d.weekday || '').slice(0, 3);
  const md = d.date.slice(5);
  return wd ? `${wd} ${md}` : md;
}

function viewToGrowthKey(view: PerfViewMode, fleetRanking: boolean): GrowthGroupKey {
  if (!fleetRanking || view === 'selected' || view === 'all') return 'all';
  if (view === 'top5') return 'top5';
  if (view === 'lowest5') return 'lowest5';
  return 'all';
}

/** Signed growth: (current − compare) ÷ compare × 100 ≡ index − 100. */
function formatGrowthDeltaPct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const d = Math.round((rate - 100) * 10) / 10;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d}%`;
}

function KpiBox({
  label,
  value,
  hint,
  tone,
  onClick,
  title,
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'up' | 'down' | 'neutral';
  onClick?: () => void;
  title?: string;
  /** Emphasize as a direct jump (e.g. product mix insights). */
  action?: boolean;
}) {
  const cls =
    tone === 'up' ? 'perfKpiToneUp' : tone === 'down' ? 'perfKpiToneDown' : 'perfKpiToneNeutral';
  const body = (
    <>
      <span className="perfKpiLabel">{label}</span>
      <strong>{value}</strong>
      {hint ? <span className="perfKpiHint">{hint}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`perfKpi perfKpiWide ${cls} perfKpiClickable${action ? ' perfKpiAction' : ''}`}
        onClick={onClick}
        title={title || 'Open insights'}
      >
        {body}
      </button>
    );
  }
  return <div className={`perfKpi perfKpiWide ${cls}`}>{body}</div>;
}

function KpiInsightModal({
  title,
  subtitle,
  explain,
  stats,
  onClose,
}: {
  title: string;
  subtitle?: string;
  explain: string[];
  stats?: Array<{ label: string; value: string }>;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal perfGrowthModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Location insights</p>
            <h2 className="salesHistoryTitle">{title}</h2>
            {subtitle ? <p className="salesHistorySub">{subtitle}</p> : null}
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">
          {stats?.length ? (
            <dl className="perfKpiInsightStats">
              {stats.map((s) => (
                <div key={s.label} className="perfKpiInsightStat">
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <ul className="perfKpiInsightList">
            {explain.map((line) => (
              <li key={line.slice(0, 48)}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    getAlertModalPortal(),
  );
}

function GraphMachinePickerModal({
  machines,
  selectedIds,
  pageIds,
  onApply,
  onClose,
}: {
  machines: FleetMachine[];
  selectedIds: string[];
  /** Machines currently on the graph page (for quick add). */
  pageIds: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Set<string>>(() => new Set(selectedIds));
  const ranked = useMemo(() => sortMachinesBySales(machines), [machines]);
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    ranked.forEach((row, i) => m.set(row.machineId, i + 1));
    return m;
  }, [ranked]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return ranked;
    return ranked.filter((m) => m.machineName.toLowerCase().includes(n));
  }, [ranked, q]);

  const toggle = (id: string) => {
    setPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < GRAPH_PAGE) next.add(id);
      return next;
    });
  };

  const applyTopLowest = () => {
    const top = ranked.slice(0, 6).map((m) => m.machineId);
    const low = [...ranked].reverse().slice(0, 6).map((m) => m.machineId);
    const merged: string[] = [];
    for (const id of [...top, ...low]) {
      if (!merged.includes(id) && merged.length < GRAPH_PAGE) merged.push(id);
    }
    setPick(new Set(merged));
  };

  const applyThisPage = () => {
    setPick(new Set(pageIds.slice(0, GRAPH_PAGE)));
  };

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal perfGrowthModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Performance Trajectory</p>
            <h2 className="salesHistoryTitle">Mix machines on one graph</h2>
            <p className="salesHistorySub">
              Pick any up to {GRAPH_PAGE} — e.g. a top seller with a low performer from another page.{' '}
              {pick.size}/{GRAPH_PAGE} selected.
            </p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">
        <div className="perfGrowthModalBody">
          <div className="perfGraphPickQuick" role="group" aria-label="Quick picks">
            <button type="button" className="perfSegPill" onClick={applyTopLowest}>
              Top 6 + Lowest 6
            </button>
            <button type="button" className="perfSegPill" onClick={applyThisPage} disabled={!pageIds.length}>
              Use current page
            </button>
            <button type="button" className="perfSegPill" onClick={() => setPick(new Set())}>
              Clear pick
            </button>
          </div>
          <input
            type="search"
            className="perfLocSearch"
            placeholder="Search by name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="perfLocDropdownList perfGraphPickList">
            {filtered.map((m) => {
              const on = pick.has(m.machineId);
              const blocked = !on && pick.size >= GRAPH_PAGE;
              const rank = rankById.get(m.machineId);
              return (
                <label key={m.machineId} className={`perfMachineRow ${on ? 'perfMachineRowSolo' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={blocked}
                    onChange={() => toggle(m.machineId)}
                  />
                  <span className="perfGraphPickRank">#{rank}</span>
                  <span className="perfMachineRowName">{m.machineName}</span>
                  <span className="perfMachineRowId">{formatKwd(m.totalLocationKwd)}</span>
                </label>
              );
            })}
          </div>
          <div className="perfGraphPickActions">
            <button
              type="button"
              className="perfSegPill active"
              onClick={() => {
                onApply([...pick]);
                onClose();
              }}
              disabled={pick.size === 0}
            >
              Show on graph
            </button>
          </div>
        </div>
      
        </div></div>
    </div>,
    getAlertModalPortal(),
  );
}

export function PerfOverviewSection({
  machines,
  aggregateDays,
  kpis,
  preset,
  onPresetChange,
  windowLabel,
  windowMeta,
  loading,
  fleetRanking = true,
  selectionLabel,
  onOpenMachineProducts,
}: {
  machines: FleetMachine[];
  aggregateDays: PerfDay[];
  kpis?: FleetKpis | null;
  preset: PerfPreset;
  onPresetChange: (p: PerfPreset) => void;
  windowLabel?: string;
  windowMeta?: {
    start?: string;
    end?: string;
    prevStart?: string;
    prevEnd?: string;
    yoyStart?: string;
    yoyEnd?: string;
  } | null;
  loading?: boolean;
  fleetRanking?: boolean;
  selectionLabel?: string;
  onOpenMachineProducts?: (machineId: string, machineName: string) => void;
}) {
  const [view, setView] = useState<PerfViewMode>('all');
  const [combined, setCombined] = useState(true);
  const [growthModal, setGrowthModal] = useState<'prev' | 'yoy' | null>(null);
  const [insightModal, setInsightModal] = useState<'deficit' | 'achievement' | 'ytd' | 'period' | null>(
    null,
  );
  const [page, setPage] = useState(0);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [customIds, setCustomIds] = useState<string[] | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!fleetRanking) setView('selected');
    else setView((v) => (v === 'selected' ? 'all' : v));
  }, [fleetRanking]);

  const ranked = useMemo(() => sortMachinesBySales(machines), [machines]);

  const fleetTotalKd = kpis?.periodActualKd ?? sumPeriodKd(ranked);

  const pagePool = useMemo(() => {
    if (customIds?.length) {
      const map = new Map(ranked.map((m) => [m.machineId, m]));
      return customIds.map((id) => map.get(id)).filter((m): m is FleetMachine => Boolean(m));
    }
    if (!fleetRanking || view === 'selected') {
      const start = page * GRAPH_PAGE;
      return ranked.slice(start, start + GRAPH_PAGE);
    }
    if (view === 'top5') return pickTop5(ranked);
    if (view === 'lowest5') return pickLowest5(ranked);
    const start = page * GRAPH_PAGE;
    return ranked.slice(start, start + GRAPH_PAGE);
  }, [ranked, view, fleetRanking, page, customIds]);

  /** Machines summed into the fleet-combined line (matches All / Top 5 / Lowest 5 / mix). */
  const combinedPool = useMemo(() => {
    if (customIds?.length) {
      const map = new Map(ranked.map((m) => [m.machineId, m]));
      return customIds.map((id) => map.get(id)).filter((m): m is FleetMachine => Boolean(m));
    }
    if (view === 'top5') return pickTop5(ranked);
    if (view === 'lowest5') return pickLowest5(ranked);
    return ranked;
  }, [ranked, view, customIds]);

  const groupSharePct = useMemo(() => {
    if (!fleetTotalKd || fleetTotalKd <= 0) return null;
    const groupKd = sumPeriodKd(combinedPool);
    return shareOfFleetPct(groupKd, fleetTotalKd);
  }, [combinedPool, fleetTotalKd]);

  const pageCount = useMemo(() => {
    if (customIds?.length) return 1;
    if (view === 'top5' || view === 'lowest5') return 1;
    return Math.max(1, Math.ceil(ranked.length / GRAPH_PAGE));
  }, [ranked.length, view, customIds]);

  useEffect(() => {
    setPage(0);
    setHiddenIds(new Set());
  }, [view, machines, customIds]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const seriesMachines = useMemo(
    () => pagePool.filter((m) => !hiddenIds.has(m.machineId)),
    [pagePool, hiddenIds],
  );

  const labels = useMemo(() => {
    const first = seriesMachines[0]?.days?.length ? seriesMachines[0].days : aggregateDays;
    return first.map((d) => dayLabel(d));
  }, [seriesMachines, aggregateDays]);

  const growthKey = viewToGrowthKey(view, fleetRanking);
  const growthPrevSlice = kpis?.growthVsPrev?.[growthKey] ?? kpis?.growthVsPrev?.all;
  const growthYoySlice = kpis?.growthVsYoy?.[growthKey] ?? kpis?.growthVsYoy?.all;
  const growthPrevPct = growthPrevSlice?.ratePct ?? kpis?.growthRatePct ?? null;
  const growthYoyPct = growthYoySlice?.ratePct ?? kpis?.yoyGrowthRatePct ?? null;
  const ytdSlice = kpis?.ytdCompare;
  const ytdPct = ytdSlice?.ratePct ?? null;

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: 'canvas' });
    chartInst.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInst.current;
    if (!chart) return;
    const theme = readTheme();
    if (!seriesMachines.length || !labels.length) {
      chart.clear();
      return;
    }

    const dayCount = labels.length;
    const series: echarts.SeriesOption[] = [];

    if (combined) {
      const pool = combinedPool.length ? combinedPool : seriesMachines;
      const totals: number[] = [];
      const tgtSum: (number | null)[] = [];
      for (let i = 0; i < dayCount; i++) {
        let sum = 0;
        let tSum = 0;
        let tN = 0;
        for (const m of pool) {
          sum += Number(m.days?.[i]?.locationKwd) || 0;
          const t = Number(m.days?.[i]?.locationTargetKd);
          if (Number.isFinite(t) && t > 0) {
            tSum += t;
            tN += 1;
          }
        }
        totals.push(Math.round(sum * 100) / 100);
        tgtSum.push(tN ? Math.round(tSum * 100) / 100 : null);
      }
      const scopeLabel =
        view === 'top5'
          ? 'Top 5 combined'
          : view === 'lowest5'
            ? 'Lowest 5 combined'
            : customIds?.length
              ? `Mix (${pool.length})`
              : `Combined sales (${pool.length})`;
      series.push({
        name: scopeLabel,
        type: 'line',
        smooth: 0.25,
        showSymbol: dayCount <= 10,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { width: 3, color: '#2dd4bf' },
        itemStyle: { color: '#2dd4bf' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(45, 212, 191, 0.28)' },
            { offset: 1, color: 'rgba(45, 212, 191, 0.02)' },
          ]),
        },
        data: totals,
      });
      if (tgtSum.some((v) => v != null)) {
        series.push({
          name: 'Combined daily target',
          type: 'line',
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.5, type: 'dashed', color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
          data: tgtSum,
        });
      }
    } else {
      seriesMachines.forEach((m, i) => {
        const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
        const days = m.days || [];
        series.push({
          name: m.machineName,
          type: 'line',
          smooth: 0.25,
          showSymbol: days.length <= 10,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2.4, color },
          itemStyle: { color },
          emphasis: {
            focus: 'series',
            blurScope: 'coordinateSystem',
            lineStyle: { width: 3.6, shadowBlur: 12, shadowColor: color },
            itemStyle: { shadowBlur: 10, shadowColor: color },
          },
          blur: { lineStyle: { opacity: 0.15 }, itemStyle: { opacity: 0.15 } },
          data: days.map((d) => Number(d.locationKwd) || 0),
        });
      });
      const tgtByIdx: (number | null)[] = labels.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (const m of seriesMachines) {
          const t = Number(m.days?.[i]?.locationTargetKd);
          if (Number.isFinite(t) && t > 0) {
            sum += t;
            n += 1;
          }
        }
        return n ? Math.round((sum / n) * 100) / 100 : null;
      });
      if (tgtByIdx.some((v) => v != null)) {
        series.push({
          name: 'Avg daily target',
          type: 'line',
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.5, type: 'dashed', color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
          data: tgtByIdx,
        });
      }
    }

    chart.setOption(
      {
        backgroundColor: 'transparent',
        animationDuration: 450,
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'line',
            lineStyle: { color: theme.cross, type: 'dashed' },
            label: { show: false },
          },
          backgroundColor: theme.tipBg,
          borderWidth: 0,
          padding: [10, 12],
          textStyle: { color: '#e8f4fc', fontSize: 12 },
          formatter: (params: unknown) => {
            const arr = params as {
              seriesName?: string;
              value?: number | null;
              dataIndex?: number;
              color?: string;
            }[];
            const i = arr[0]?.dataIndex ?? 0;
            const tipDay = seriesMachines[0]?.days?.[i] || aggregateDays[i];
            const wd = (tipDay?.weekday || '').slice(0, 3);
            const dateStr = tipDay?.date || '';
            const head =
              wd && dateStr ? `${wd} · ${dateStr}` : dateStr || labels[i] || '';
            const lines = [
              `<div style="font-weight:700;margin-bottom:6px">${head}</div>`,
            ];
            for (const p of arr) {
              if (p.value == null || !Number.isFinite(Number(p.value))) continue;
              if (combined || p.seriesName === 'Combined sales') {
                lines.push(
                  `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span><b>${p.seriesName}</b>: ${formatKwd(Number(p.value))} · ${seriesMachines.length} machines</div>`,
                );
                continue;
              }
              if (p.seriesName === 'Combined daily target' || p.seriesName === 'Avg daily target') {
                lines.push(
                  `<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span><b>${p.seriesName}</b>: ${formatKwd(Number(p.value))}</div>`,
                );
                continue;
              }
              const m = seriesMachines.find((x) => x.machineName === p.seriesName);
              const day = m?.days?.[i];
              const pct = day?.locationPctOfTarget;
              const g = day?.locationGrowthPct;
              const tipBits = [
                `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>`,
                `<b>${p.seriesName}</b>: ${formatKwd(Number(p.value))}`,
              ];
              if (pct != null) {
                const tgtColor = pct >= 100 ? '#53e16f' : pct < 80 ? '#ff3b30' : '#94a3b8';
                tipBits.push(
                  ` · <span style="color:${tgtColor};font-weight:600">${pct}% of target</span>`,
                );
              }
              if (g != null) tipBits.push(` · ${formatSalesTrendHtml(g)}`);
              lines.push(`<div>${tipBits.join('')}</div>`);
            }
            return lines.join('');
          },
        },
        legend: { show: false },
        grid: { left: 52, right: 18, top: 16, bottom: 36 },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: false,
          axisLabel: {
            color: theme.muted,
            fontSize: 11,
            fontWeight: 600,
            rotate: labels.length > 14 ? 30 : 0,
          },
          axisLine: { lineStyle: { color: theme.grid } },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          name: 'KD',
          nameTextStyle: { color: theme.muted, fontSize: 10 },
          axisLabel: {
            color: theme.muted,
            fontSize: 10,
            formatter: (v: number) => (v >= 10 ? `${Math.round(v)}` : v.toFixed(1)),
          },
          splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
          axisLine: { show: false },
        },
        series,
      } as echarts.EChartsOption,
      { notMerge: true },
    );
    chart.resize();
  }, [seriesMachines, labels, combined, aggregateDays, combinedPool, view, customIds]);

  const onExport = useCallback(() => {
    const c = chartInst.current;
    if (c)
      downloadChartPng(
        c,
        chartFilename(['perf-trajectory', preset, view, combined ? 'combined' : 'multi']),
      );
  }, [preset, view, combined]);

  const deficitTone =
    kpis?.deficitKd == null ? 'neutral' : kpis.deficitKd >= 0 ? 'up' : 'down';
  const growthTone =
    growthPrevPct == null ? 'neutral' : growthPrevPct >= 100 ? 'up' : 'down';
  const yoyTone = growthYoyPct == null ? 'neutral' : growthYoyPct >= 100 ? 'up' : 'down';
  const ytdTone = ytdPct == null ? 'neutral' : ytdPct >= 100 ? 'up' : 'down';
  const achTone =
    kpis?.achievementRatePct == null
      ? 'neutral'
      : kpis.achievementRatePct >= 50
        ? 'up'
        : 'down';

  const prevWin =
    windowMeta?.prevStart && windowMeta?.prevEnd
      ? `${windowMeta.prevStart} → ${windowMeta.prevEnd}`
      : 'previous period';
  const yoyWin =
    windowMeta?.yoyStart && windowMeta?.yoyEnd
      ? `${windowMeta.yoyStart} → ${windowMeta.yoyEnd}`
      : 'same dates last year';
  const ytdWinThis =
    ytdSlice?.thisStart && ytdSlice?.thisEnd
      ? `${ytdSlice.thisStart} → ${ytdSlice.thisEnd}`
      : 'Jan 1 → today';
  const ytdWinLast =
    ytdSlice?.lastStart && ytdSlice?.lastEnd
      ? `${ytdSlice.lastStart} → ${ytdSlice.lastEnd}`
      : 'same dates last year';

  const growthScopeNote =
    growthKey === 'top5'
      ? 'Figures below follow the Top 5 by period sales. Each row shows % of fleet period KD.'
      : growthKey === 'lowest5'
        ? 'Figures below follow the Lowest 5 by period sales (zero-sales machines excluded). Each row shows % of fleet period KD.'
        : 'Figures below follow all machines in the current selection. Each row shows % of fleet period KD.';

  const canPage = !customIds?.length && view !== 'top5' && view !== 'lowest5' && pageCount > 1;
  const touchStartX = useRef<number | null>(null);

  const goPrevPage = useCallback(() => {
    setPage((p) => Math.max(0, p - 1));
  }, []);
  const goNextPage = useCallback(() => {
    setPage((p) => Math.min(pageCount - 1, p + 1));
  }, [pageCount]);

  const onGraphTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (!canPage) return;
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  };
  const onGraphTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (!canPage || touchStartX.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const dx = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 56) return;
    if (dx < 0) goNextPage();
    else goPrevPage();
  };

  const mixSeed = seriesMachines[0] || ranked[0];

  return (
    <section className="perfOverviewHero" aria-labelledby="perf-hero-title">
      <header className="perfOverviewHead">
        <div className="perfOverviewHeadText">
          <h3 id="perf-hero-title" className="perfSectionTitle">
            Performance Trajectory
          </h3>
          <p className="perfSectionHint">
            Daily location KD — up to {GRAPH_PAGE} lines listed above the graph. Use side arrows (or
            swipe on iPad) to change pages; <strong>Mix machines</strong> for any custom set.
            {windowLabel ? ` · ${windowLabel}` : ''}
            {!fleetRanking
              ? ` · ${selectionLabel || 'Selected locations'} (Top/Lowest need a larger set).`
              : ''}
            {customIds?.length ? ` · Custom ${customIds.length} on graph` : ''}
          </p>
        </div>
        <ChartExportButton onExport={onExport} label="Download Performance Trajectory as PNG" />
      </header>

      <div className="perfFleetCombinedStrip" aria-label="Fleet combined period totals">
        <div className="perfFleetCombinedStripItem">
          <span className="perfFleetCombinedStripLabel">Fleet period KD</span>
          <strong>
            {loading ? '…' : kpis?.periodActualKd != null ? formatKwd(kpis.periodActualKd) : '—'}
          </strong>
        </div>
        <div className="perfFleetCombinedStripItem">
          <span className="perfFleetCombinedStripLabel">Fleet target</span>
          <strong>
            {loading ? '…' : kpis?.periodTargetKd != null ? formatKwd(kpis.periodTargetKd) : '—'}
          </strong>
        </div>
        <div className="perfFleetCombinedStripItem">
          <span className="perfFleetCombinedStripLabel">Achievement</span>
          <strong>
            {loading
              ? '…'
              : kpis?.achievementRatePct != null
                ? `${kpis.achievementRatePct}%`
                : '—'}
          </strong>
        </div>
        <div className="perfFleetCombinedStripItem">
          <span className="perfFleetCombinedStripLabel">Machines</span>
          <strong>{machines.length}</strong>
        </div>
        <p className="perfFleetCombinedStripHint">
          Combined totals for machines in the current view (All / Top 5 / Lowest 5 / mix) · period
          preset below (WTD / last week / …)
          {groupSharePct != null && (view === 'top5' || view === 'lowest5' || customIds?.length) ? (
            <>
              {' '}
              · This group = <strong>{groupSharePct}%</strong> of fleet period KD (
              {formatKwd(sumPeriodKd(combinedPool))} / {formatKwd(fleetTotalKd)})
            </>
          ) : null}
        </p>
      </div>

      <div className="perfToolbarRow">
        <div className="perfModePills" role="group" aria-label="Machine view">
          {fleetRanking ? (
            FLEET_VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`perfSegPill ${view === v.id && !customIds ? 'active' : ''}`}
                onClick={() => {
                  setCustomIds(null);
                  setView(v.id);
                }}
              >
                {v.label}
              </button>
            ))
          ) : (
            <span className="perfSegPill active">
              {selectionLabel || `Selected (${machines.length})`}
            </span>
          )}
          <button
            type="button"
            className={`perfSegPill ${combined ? 'active' : ''}`}
            onClick={() => setCombined((c) => !c)}
            title="One line = sum of machines in the current view (All, Top 5, Lowest 5, or mix)"
          >
            {combined ? 'Fleet combined on' : 'Fleet combined'}
          </button>
          <button
            type="button"
            className={`perfSegPill perfSegPillEmphasis ${customIds ? 'active' : ''}`}
            onClick={() => setPickOpen(true)}
            title="Pick any machines from the full list (across pages) — up to 12 lines"
          >
            Mix machines
          </button>
          {customIds ? (
            <button type="button" className="perfSegPill" onClick={() => setCustomIds(null)}>
              Clear mix
            </button>
          ) : null}
        </div>
        <div className="perfModePills" role="group" aria-label="Time period">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`perfSegPill ${preset === p.id ? 'active' : ''}`}
              onClick={() => onPresetChange(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="perfGraphPageMeta" aria-live="polite">
        {view === 'lowest5' && !pagePool.length
          ? 'Lowest 5 — no machines with period sales above zero (or fewer than 6 active locations).'
          : customIds?.length
          ? `Custom mix · ${pagePool.length} machines${
              groupSharePct != null ? ` · ${groupSharePct}% of fleet period KD` : ''
            }`
          : view === 'top5' || view === 'lowest5'
            ? `${pagePool.length} machines · ${
                groupSharePct != null ? `${groupSharePct}% of fleet period KD` : ''
              }`
          : canPage
            ? `Page ${page + 1} / ${pageCount} · ranks ${page * GRAPH_PAGE + 1}–${page * GRAPH_PAGE + pagePool.length} of ${ranked.length} · swipe or use side arrows`
            : `${pagePool.length} machines on graph`}
      </div>

      {pagePool.length > 0 ? (
        <div className="perfGraphLegend" role="list" aria-label="Machines on this graph">
          {pagePool.map((m, i) => {
            const on = !hiddenIds.has(m.machineId);
            const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
            const kd = Number(m.totalLocationKwd) || 0;
            const share = shareOfFleetPct(kd, fleetTotalKd);
            return (
              <button
                key={m.machineId}
                type="button"
                role="listitem"
                className={`perfGraphLegendItem ${on ? 'active' : ''}`}
                style={{ ['--series-color' as string]: color }}
                onMouseEnter={() => {
                  const c = chartInst.current;
                  if (!c || !on || combined) return;
                  c.dispatchAction({ type: 'downplay' });
                  c.dispatchAction({ type: 'highlight', seriesName: m.machineName });
                }}
                onMouseLeave={() => {
                  if (!combined) chartInst.current?.dispatchAction({ type: 'downplay' });
                }}
                onClick={() =>
                  setHiddenIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.machineId)) next.delete(m.machineId);
                    else next.add(m.machineId);
                    return next;
                  })
                }
                title={
                  share != null
                    ? `${formatKwd(kd)} · ${share}% of fleet period KD`
                    : on
                      ? 'Hover to focus · click to hide'
                      : 'Show line'
                }
              >
                <span className="perfGraphLegendLine" aria-hidden />
                <span className="perfGraphLegendName">{m.machineName}</span>
                {share != null ? (
                  <span className="perfGraphLegendShare">{formatKwd(kd)} · {share}%</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {loading ? <p className="perfMuted">Loading overview…</p> : null}

      <div
        className="perfGraphStage"
        onTouchStart={onGraphTouchStart}
        onTouchEnd={onGraphTouchEnd}
      >
        <button
          type="button"
          className="perfGraphSideBtn"
          disabled={!canPage || page <= 0}
          onClick={goPrevPage}
          aria-label="Previous graph page"
        >
          ‹
        </button>
        <div
          ref={chartRef}
          className="perfEchart perfEchartOverview"
          role="img"
          aria-label="Performance Trajectory"
        />
        <button
          type="button"
          className="perfGraphSideBtn"
          disabled={!canPage || page >= pageCount - 1}
          onClick={goNextPage}
          aria-label="Next graph page"
        >
          ›
        </button>
      </div>

      <div className="perfKpiRow perfKpiRowHero">
        {onOpenMachineProducts ? (
          <KpiBox
            label="Product mix"
            value="Open insights"
            hint={
              mixSeed
                ? `Starts at ${mixSeed.machineName} · search any`
                : 'Day / week / month · YoY by KD'
            }
            tone="neutral"
            action
            title="Product mix insights — day / week / month sales KD, top & low drinks, YoY. Switch location inside."
            onClick={() => {
              if (!mixSeed) return;
              onOpenMachineProducts(mixSeed.machineId, mixSeed.machineName);
            }}
          />
        ) : null}
        <KpiBox
          label="Deficit"
          value={
            loading
              ? '…'
              : kpis?.deficitKd == null
                ? '—'
                : `${kpis.deficitKd >= 0 ? '+' : ''}${formatKwd(kpis.deficitKd)}`
          }
          hint="Tap for details"
          tone={deficitTone}
          onClick={() => setInsightModal('deficit')}
          title="How deficit is calculated"
        />
        <KpiBox
          label="Target achievement"
          value={loading ? '…' : kpis?.achievementRatePct != null ? `${kpis.achievementRatePct}%` : '—'}
          hint="Tap for details"
          tone={achTone}
          onClick={() => setInsightModal('achievement')}
          title="How target achievement is calculated"
        />
        <KpiBox
          label="Growth vs prior period"
          value={loading ? '…' : formatGrowthDeltaPct(growthPrevPct)}
          hint="Tap for details"
          tone={growthTone}
          onClick={kpis?.growthVsPrev ? () => setGrowthModal('prev') : undefined}
        />
        <KpiBox
          label="Growth vs same dates last year"
          value={loading ? '…' : formatGrowthDeltaPct(growthYoyPct)}
          hint="Tap for details"
          tone={yoyTone}
          onClick={kpis?.growthVsYoy ? () => setGrowthModal('yoy') : undefined}
        />
        <KpiBox
          label="YTD vs last year"
          value={loading ? '…' : formatGrowthDeltaPct(ytdPct)}
          hint="Tap for details"
          tone={ytdTone}
          onClick={() => setInsightModal('ytd')}
          title={`This year YTD (${ytdWinThis}) vs last year (${ytdWinLast})`}
        />
        <KpiBox
          label="Period KD"
          value={loading ? '…' : kpis?.periodActualKd != null ? formatKwd(kpis.periodActualKd) : '—'}
          hint="Tap for details"
          tone="neutral"
          onClick={() => setInsightModal('period')}
          title="Period sales vs target"
        />
      </div>

      {insightModal === 'deficit' ? (
        <KpiInsightModal
          title="Deficit"
          subtitle={windowLabel || undefined}
          stats={[
            {
              label: 'Deficit',
              value:
                kpis?.deficitKd == null
                  ? '—'
                  : `${kpis.deficitKd >= 0 ? '+' : ''}${formatKwd(kpis.deficitKd)}`,
            },
            {
              label: 'Period KD',
              value: kpis?.periodActualKd != null ? formatKwd(kpis.periodActualKd) : '—',
            },
            {
              label: 'Period target',
              value: kpis?.periodTargetKd != null ? formatKwd(kpis.periodTargetKd) : '—',
            },
          ]}
          explain={[
            'Deficit = period actual KD − period target KD for the machines in scope.',
            'Positive means above target (ahead). Negative means below target (short).',
            'If no target is set for the window, the card shows —.',
          ]}
          onClose={() => setInsightModal(null)}
        />
      ) : null}
      {insightModal === 'achievement' ? (
        <KpiInsightModal
          title="Target achievement"
          subtitle={windowLabel || undefined}
          stats={[
            {
              label: 'Share of machines on target',
              value: kpis?.achievementRatePct != null ? `${kpis.achievementRatePct}%` : '—',
            },
            {
              label: 'On target',
              value:
                kpis?.machinesWithTarget != null
                  ? `${kpis.machinesOnTarget ?? 0} / ${kpis.machinesWithTarget}`
                  : '—',
            },
          ]}
          explain={[
            'Counts machines that have a target in this window and finished at or above that target.',
            'Achievement % = machines on target ÷ machines with a target × 100.',
            'Machines without a target are excluded from the denominator.',
          ]}
          onClose={() => setInsightModal(null)}
        />
      ) : null}
      {insightModal === 'ytd' ? (
        <KpiInsightModal
          title="YTD vs last year"
          subtitle={`${ytdWinThis} vs ${ytdWinLast}`}
          stats={[
            {
              label: 'This year YTD',
              value: ytdSlice?.periodKd != null ? formatKwd(ytdSlice.periodKd) : '—',
            },
            {
              label: 'Last year same dates',
              value: ytdSlice?.compareKd != null ? formatKwd(ytdSlice.compareKd) : '—',
            },
            { label: 'Growth', value: formatGrowthDeltaPct(ytdPct) },
          ]}
          explain={[
            'Calendar year-to-date through today (Kuwait) vs the same dates last year.',
            'Growth = (this YTD − last YTD) ÷ last YTD × 100.',
            'Index 100 = flat vs last year; above 100 = ahead; below 100 = behind.',
          ]}
          onClose={() => setInsightModal(null)}
        />
      ) : null}
      {insightModal === 'period' ? (
        <KpiInsightModal
          title="Period KD"
          subtitle={windowLabel || undefined}
          stats={[
            {
              label: 'Actual',
              value: kpis?.periodActualKd != null ? formatKwd(kpis.periodActualKd) : '—',
            },
            {
              label: 'Target',
              value: kpis?.periodTargetKd != null ? formatKwd(kpis.periodTargetKd) : '—',
            },
            {
              label: 'Series on graph',
              value: String(seriesMachines.length),
            },
          ]}
          explain={[
            'Period KD is total location sales for the selected time preset and machine scope.',
            'Target is the sum of location targets for machines that have one in this window.',
            'The graph above shows daily trajectory; this card is the period total.',
          ]}
          onClose={() => setInsightModal(null)}
        />
      ) : null}

      {growthModal === 'prev' && kpis?.growthVsPrev ? (
        <GrowthCompareModal
          title="Growth vs prior period"
          subtitle={`Selected period: ${windowLabel || '—'}. Compare (prior) window: ${prevWin}.`}
          explain={[
            growthScopeNote,
            'Growth (big number on the card) = (this period KD − prior KD) ÷ prior KD × 100. Example: −1.2% means sales are 1.2% below the prior window.',
            'Index (% of prior) = this period ÷ prior × 100. 100 = flat, above 100 = higher than prior, below 100 = lower.',
            'Top 5 / Lowest 5 groups are ranked by this period’s sales KD (Lowest 5 excludes zero-sales machines).',
            'Share of fleet = machine or group period KD ÷ full fleet period KD × 100.',
          ]}
          compareLabel="Prior KD"
          indexLabel="% of prior"
          groups={kpis.growthVsPrev}
          onOpenMachineProducts={
            onOpenMachineProducts
              ? (id, name) => {
                  setGrowthModal(null);
                  onOpenMachineProducts(id, name);
                }
              : undefined
          }
          onClose={() => setGrowthModal(null)}
        />
      ) : null}
      {growthModal === 'yoy' && kpis?.growthVsYoy ? (
        <GrowthCompareModal
          title="Growth vs same dates last year"
          subtitle={`Selected period: ${windowLabel || '—'}. Same calendar dates last year: ${yoyWin}.`}
          explain={[
            growthScopeNote,
            'This is not full-year or YTD. It compares the selected date range to the same dates one year earlier.',
            'Growth (big number on the card) = (this period KD − then KD) ÷ then KD × 100. Example: +5% means sales are 5% above those same dates last year.',
            'Index (% of then) = this period ÷ then × 100. 100 = flat vs last year.',
            'Top 5 / Lowest 5 groups are ranked by this period’s sales KD (Lowest 5 excludes zero-sales machines).',
            'Share of fleet = machine or group period KD ÷ full fleet period KD × 100.',
          ]}
          compareLabel="Then KD"
          indexLabel="% of then"
          groups={kpis.growthVsYoy}
          onOpenMachineProducts={
            onOpenMachineProducts
              ? (id, name) => {
                  setGrowthModal(null);
                  onOpenMachineProducts(id, name);
                }
              : undefined
          }
          onClose={() => setGrowthModal(null)}
        />
      ) : null}
      {pickOpen ? (
        <GraphMachinePickerModal
          machines={ranked}
          selectedIds={customIds || pagePool.map((m) => m.machineId)}
          pageIds={pagePool.map((m) => m.machineId)}
          onApply={(ids) => setCustomIds(ids)}
          onClose={() => setPickOpen(false)}
        />
      ) : null}
    </section>
  );
}
