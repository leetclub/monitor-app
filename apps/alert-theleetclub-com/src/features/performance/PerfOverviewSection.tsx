import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { ChartExportWrap } from '@/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/lib/chartExport';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import {
  SERIES_PALETTE,
  type FleetMachine,
  type FleetKpis,
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

function pickMachines(
  machines: FleetMachine[],
  mode: PerfViewMode,
  fleetRanking: boolean,
): FleetMachine[] {
  // Subset selection: chart exactly what was selected — Top/Lowest/All-fleet are N/A
  if (!fleetRanking || mode === 'selected') {
    return [...machines].sort(
      (a, b) =>
        (b.periodPctOfTarget ?? -1) - (a.periodPctOfTarget ?? -1) ||
        b.totalLocationKwd - a.totalLocationKwd,
    );
  }
  const ranked = [...machines].sort(
    (a, b) =>
      (b.periodPctOfTarget ?? -1) - (a.periodPctOfTarget ?? -1) ||
      b.totalLocationKwd - a.totalLocationKwd,
  );
  if (mode === 'top5') return ranked.slice(0, 5);
  if (mode === 'lowest5') return [...ranked].reverse().slice(0, 5);
  return ranked.slice(0, 12);
}

function KpiBox({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'up' | 'down' | 'neutral';
}) {
  const cls =
    tone === 'up' ? 'perfKpiToneUp' : tone === 'down' ? 'perfKpiToneDown' : 'perfKpiToneNeutral';
  return (
    <div className={`perfKpi perfKpiWide ${cls}`}>
      <span className="perfKpiLabel">{label}</span>
      <strong>{value}</strong>
      {hint ? <span className="perfKpiHint">{hint}</span> : null}
    </div>
  );
}

export function PerfOverviewSection({
  machines,
  aggregateDays,
  kpis,
  preset,
  onPresetChange,
  windowLabel,
  loading,
  /** When false (1–few locations selected), hide All/Top5/Lowest5 fleet ranking. */
  fleetRanking = true,
  selectionLabel,
}: {
  machines: FleetMachine[];
  aggregateDays: PerfDay[];
  kpis?: FleetKpis | null;
  preset: PerfPreset;
  onPresetChange: (p: PerfPreset) => void;
  windowLabel?: string;
  loading?: boolean;
  fleetRanking?: boolean;
  selectionLabel?: string;
}) {
  const [view, setView] = useState<PerfViewMode>('top5');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!fleetRanking) setView('selected');
    else setView((v) => (v === 'selected' ? 'top5' : v));
  }, [fleetRanking]);

  const seriesMachines = useMemo(
    () => pickMachines(machines, fleetRanking ? view : 'selected', fleetRanking),
    [machines, view, fleetRanking],
  );

  const labels = useMemo(() => {
    const first = seriesMachines[0]?.days?.length
      ? seriesMachines[0].days
      : aggregateDays;
    return first.map((d) => dayLabel(d));
  }, [seriesMachines, aggregateDays]);

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

    const series: echarts.SeriesOption[] = seriesMachines.map((m, i) => {
      const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
      const days = m.days || [];
      return {
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
      };
    });

    // Target pace line (fleet average daily target across shown machines)
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

    chart.setOption(
      {
        backgroundColor: 'transparent',
        animationDuration: 450,
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'cross',
            crossStyle: { color: theme.cross },
            lineStyle: { color: theme.cross, type: 'dashed' },
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
            const dateStr = seriesMachines[0]?.days?.[i]?.date || '';
            const lines = [
              `<div style="font-weight:700;margin-bottom:6px">${labels[i] || ''}${
                dateStr ? ` · ${dateStr}` : ''
              }</div>`,
            ];
            for (const p of arr) {
              if (p.value == null || !Number.isFinite(Number(p.value))) continue;
              const m = seriesMachines.find((x) => x.machineName === p.seriesName);
              const day = m?.days?.[i];
              const pct = day?.locationPctOfTarget;
              const g = day?.locationGrowthPct;
              const tipBits = [
                `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>`,
                `<b>${p.seriesName}</b>: ${formatKwd(Number(p.value))}`,
              ];
              if (pct != null) tipBits.push(` · ${pct}% of target`);
              if (g != null) tipBits.push(` · day Δ ${formatSalesTrendPct(g)}`);
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
  }, [seriesMachines, labels]);

  const onExport = useCallback(() => {
    const c = chartInst.current;
    if (c) downloadChartPng(c, chartFilename(['perf-overview', preset, view]));
  }, [preset, view]);

  const deficitTone =
    kpis?.deficitKd == null ? 'neutral' : kpis.deficitKd >= 0 ? 'up' : 'down';
  const growthTone =
    kpis?.growthRatePct == null
      ? 'neutral'
      : kpis.growthRatePct >= 100
        ? 'up'
        : 'down';
  const achTone =
    kpis?.achievementRatePct == null
      ? 'neutral'
      : kpis.achievementRatePct >= 50
        ? 'up'
        : 'down';

  return (
    <section className="perfOverviewHero" aria-labelledby="perf-hero-title">
      <header className="perfOverviewHead">
        <div>
          <h3 id="perf-hero-title" className="perfSectionTitle">
            Overview trajectory
          </h3>
          <p className="perfSectionHint">
            Line chart of daily location KD — trading-style crosshair. Default period: last week.
            {windowLabel ? ` · ${windowLabel}` : ''}
            {!fleetRanking
              ? ' · Showing only your selected locations (Top/Lowest 5 need the full fleet).'
              : ''}
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
                className={`perfSegPill ${view === v.id ? 'active' : ''}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))
          ) : (
            <span
              className="perfSegPill active"
              title="Ranking modes apply to the full fleet only"
            >
              {selectionLabel || `Selected (${machines.length})`}
            </span>
          )}
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

      {loading ? <p className="perfMuted">Loading overview…</p> : null}

      <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
        <div
          ref={chartRef}
          className="perfEchart perfEchartOverview"
          role="img"
          aria-label="Performance overview trajectory"
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
          value={
            kpis?.achievementRatePct != null ? `${kpis.achievementRatePct}%` : '—'
          }
          hint={
            kpis?.machinesWithTarget
              ? `${kpis.machinesOnTarget ?? 0}/${kpis.machinesWithTarget} machines ≥ target`
              : 'Machines hitting target'
          }
          tone={achTone}
        />
        <KpiBox
          label="Growth rate"
          value={
            kpis?.growthRatePct != null ? `${kpis.growthRatePct}%` : '—'
          }
          hint="Period sales ÷ previous period × 100"
          tone={growthTone}
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
    </section>
  );
}
