import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { createPortal } from 'react-dom';
import { ChartExportWrap } from '@/components/ChartExportWrap';
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

function bySales(a: FleetMachine, b: FleetMachine) {
  return b.totalLocationKwd - a.totalLocationKwd;
}

function viewToGrowthKey(view: PerfViewMode, fleetRanking: boolean): GrowthGroupKey {
  if (!fleetRanking || view === 'selected' || view === 'all') return 'all';
  if (view === 'top5') return 'top5';
  if (view === 'lowest5') return 'lowest5';
  return 'all';
}

function KpiBox({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'up' | 'down' | 'neutral';
  onClick?: () => void;
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
        className={`perfKpi perfKpiWide ${cls} perfKpiClickable`}
        onClick={onClick}
        title="Open breakdown (All / Top 5 / Lowest 5)"
      >
        {body}
      </button>
    );
  }
  return <div className={`perfKpi perfKpiWide ${cls}`}>{body}</div>;
}

function GraphMachinePickerModal({
  machines,
  selectedIds,
  onApply,
  onClose,
}: {
  machines: FleetMachine[];
  selectedIds: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Set<string>>(() => new Set(selectedIds));
  const ranked = useMemo(() => [...machines].sort(bySales), [machines]);
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

  return createPortal(
    <div className="salesHistoryBackdrop" role="dialog" aria-modal="true" {...backdrop}>
      <div className="salesHistoryModal perfGrowthModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Performance Trajectory</p>
            <h2 className="salesHistoryTitle">Choose machines for the graph</h2>
            <p className="salesHistorySub">
              Up to {GRAPH_PAGE} lines. Mix top and lowest (or any set). {pick.size}/{GRAPH_PAGE}{' '}
              selected.
            </p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="perfGrowthModalBody">
          <input
            type="search"
            className="perfLocSearch"
            placeholder="Search machine…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="perfLocDropdownList perfGraphPickList">
            {filtered.map((m) => {
              const on = pick.has(m.machineId);
              const blocked = !on && pick.size >= GRAPH_PAGE;
              return (
                <label key={m.machineId} className={`perfMachineRow ${on ? 'perfMachineRowSolo' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={blocked}
                    onChange={() => toggle(m.machineId)}
                  />
                  <span className="perfMachineRowName">{m.machineName}</span>
                  <span className="perfMachineRowId">{formatKwd(m.totalLocationKwd)}</span>
                </label>
              );
            })}
          </div>
          <div className="perfGraphPickActions">
            <button type="button" className="perfSegPill" onClick={() => setPick(new Set())}>
              Clear pick
            </button>
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
      </div>
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
}) {
  const [view, setView] = useState<PerfViewMode>('all');
  const [combined, setCombined] = useState(false);
  const [growthModal, setGrowthModal] = useState<'prev' | 'yoy' | null>(null);
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

  const ranked = useMemo(() => [...machines].sort(bySales), [machines]);

  const pagePool = useMemo(() => {
    if (customIds?.length) {
      const map = new Map(ranked.map((m) => [m.machineId, m]));
      return customIds.map((id) => map.get(id)).filter((m): m is FleetMachine => Boolean(m));
    }
    if (!fleetRanking || view === 'selected') {
      const start = page * GRAPH_PAGE;
      return ranked.slice(start, start + GRAPH_PAGE);
    }
    if (view === 'top5') return ranked.slice(0, 5);
    if (view === 'lowest5') return [...ranked].reverse().slice(0, 5);
    const start = page * GRAPH_PAGE;
    return ranked.slice(start, start + GRAPH_PAGE);
  }, [ranked, view, fleetRanking, page, customIds]);

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
      const totals: number[] = [];
      const tgtSum: (number | null)[] = [];
      for (let i = 0; i < dayCount; i++) {
        let sum = 0;
        let tSum = 0;
        let tN = 0;
        for (const m of seriesMachines) {
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
      series.push({
        name: 'Combined sales',
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
          emphasis: { focus: 'series', lineStyle: { width: 3.2 } },
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
        legend: {
          type: 'scroll',
          top: 0,
          textStyle: { color: theme.muted, fontSize: 11 },
        },
        grid: { left: 52, right: 18, top: 40, bottom: 36 },
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
  }, [seriesMachines, labels, combined, aggregateDays]);

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
  const achTone =
    kpis?.achievementRatePct == null
      ? 'neutral'
      : kpis.achievementRatePct >= 50
        ? 'up'
        : 'down';

  const growthGroupHint =
    growthKey === 'top5'
      ? 'Top 5 sales · tap for All / Lowest 5'
      : growthKey === 'lowest5'
        ? 'Lowest 5 sales · tap for All / Top 5'
        : 'All selected · tap for Top / Lowest 5';

  const prevWin =
    windowMeta?.prevStart && windowMeta?.prevEnd
      ? `${windowMeta.prevStart} → ${windowMeta.prevEnd}`
      : 'previous period';
  const yoyWin =
    windowMeta?.yoyStart && windowMeta?.yoyEnd
      ? `${windowMeta.yoyStart} → ${windowMeta.yoyEnd}`
      : 'same dates last year';

  const canPage = !customIds?.length && view !== 'top5' && view !== 'lowest5' && pageCount > 1;

  return (
    <section className="perfOverviewHero" aria-labelledby="perf-hero-title">
      <header className="perfOverviewHead">
        <div>
          <h3 id="perf-hero-title" className="perfSectionTitle">
            Performance Trajectory
          </h3>
          <p className="perfSectionHint">
            Daily location KD — up to {GRAPH_PAGE} lines. Page through all machines or pick a custom
            mix (e.g. top + lowest).
            {windowLabel ? ` · ${windowLabel}` : ''}
            {!fleetRanking
              ? ` · ${selectionLabel || 'Selected locations'} (Top/Lowest need a larger set).`
              : ''}
            {customIds?.length ? ` · Custom ${customIds.length} on graph` : ''}
          </p>
        </div>
      </header>

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
          >
            {combined ? 'Combined line on' : 'Combined line'}
          </button>
          <button type="button" className={`perfSegPill ${customIds ? 'active' : ''}`} onClick={() => setPickOpen(true)}>
            Customize graph
          </button>
          {customIds ? (
            <button type="button" className="perfSegPill" onClick={() => setCustomIds(null)}>
              Clear custom
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

      <div className="perfGraphNav">
        <button
          type="button"
          className="perfGraphNavBtn"
          disabled={!canPage || page <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          aria-label="Previous 12 machines"
        >
          ‹
        </button>
        <span className="perfGraphNavLabel">
          {customIds?.length
            ? `Custom set · ${seriesMachines.length} of ${customIds.length} visible`
            : canPage
              ? `Page ${page + 1} / ${pageCount} · ${pagePool.length} machines (${ranked.length} total)`
              : `${pagePool.length} machines on graph`}
        </span>
        <button
          type="button"
          className="perfGraphNavBtn"
          disabled={!canPage || page >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          aria-label="Next 12 machines"
        >
          ›
        </button>
      </div>

      {pagePool.length > 0 ? (
        <div className="perfGraphSeriesToggles" role="group" aria-label="Toggle series on graph">
          {pagePool.map((m, i) => {
            const on = !hiddenIds.has(m.machineId);
            const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
            return (
              <button
                key={m.machineId}
                type="button"
                className={`perfSeriesChip ${on ? 'active' : ''}`}
                style={{ ['--series-color' as string]: color }}
                onClick={() =>
                  setHiddenIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.machineId)) next.delete(m.machineId);
                    else next.add(m.machineId);
                    return next;
                  })
                }
                title={on ? 'Hide from graph' : 'Show on graph'}
              >
                <span className="perfSeriesDot" />
                {m.machineName}
              </button>
            );
          })}
        </div>
      ) : null}

      {loading ? <p className="perfMuted">Loading overview…</p> : null}

      <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
        <div
          ref={chartRef}
          className="perfEchart perfEchartOverview"
          role="img"
          aria-label="Performance Trajectory"
        />
      </ChartExportWrap>

      <div className="perfKpiRow perfKpiRowHero">
        <KpiBox
          label="Deficit"
          value={
            kpis?.deficitKd == null
              ? '—'
              : `${kpis.deficitKd >= 0 ? '+' : ''}${formatKwd(kpis.deficitKd)}`
          }
          hint="Actual − target (period)"
          tone={deficitTone}
        />
        <KpiBox
          label="Target achievement"
          value={kpis?.achievementRatePct != null ? `${kpis.achievementRatePct}%` : '—'}
          hint={
            kpis?.machinesWithTarget
              ? `${kpis.machinesOnTarget ?? 0}/${kpis.machinesWithTarget} machines ≥ target`
              : 'Machines hitting target'
          }
          tone={achTone}
        />
        <KpiBox
          label="Growth rate"
          value={growthPrevPct != null ? `${growthPrevPct}%` : '—'}
          hint={growthGroupHint}
          tone={growthTone}
          onClick={kpis?.growthVsPrev ? () => setGrowthModal('prev') : undefined}
        />
        <KpiBox
          label="YoY growth"
          value={growthYoyPct != null ? `${growthYoyPct}%` : '—'}
          hint="vs same period last year · tap for details"
          tone={yoyTone}
          onClick={kpis?.growthVsYoy ? () => setGrowthModal('yoy') : undefined}
        />
        <KpiBox
          label="Period KD"
          value={kpis?.periodActualKd != null ? formatKwd(kpis.periodActualKd) : '—'}
          hint={
            kpis?.periodTargetKd != null
              ? `Target ${formatKwd(kpis.periodTargetKd)}`
              : `${seriesMachines.length} series shown`
          }
          tone="neutral"
        />
      </div>

      {growthModal === 'prev' && kpis?.growthVsPrev ? (
        <GrowthCompareModal
          title="Growth vs previous period"
          subtitle={`Selected period ÷ previous period (${prevWin}) × 100`}
          compareLabel="Prev KD"
          windowLabel={windowLabel}
          groups={kpis.growthVsPrev}
          onClose={() => setGrowthModal(null)}
        />
      ) : null}
      {growthModal === 'yoy' && kpis?.growthVsYoy ? (
        <GrowthCompareModal
          title="Growth vs last year"
          subtitle={`Selected period ÷ same dates last year (${yoyWin}) × 100`}
          compareLabel="YoY KD"
          windowLabel={windowLabel}
          groups={kpis.growthVsYoy}
          onClose={() => setGrowthModal(null)}
        />
      ) : null}
      {pickOpen ? (
        <GraphMachinePickerModal
          machines={ranked}
          selectedIds={customIds || pagePool.map((m) => m.machineId)}
          onApply={(ids) => setCustomIds(ids)}
          onClose={() => setPickOpen(false)}
        />
      ) : null}
    </section>
  );
}
