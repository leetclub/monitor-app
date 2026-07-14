import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as echarts from 'echarts';
import { ChartExportWrap } from '@/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/lib/chartExport';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import {
  SERIES_PALETTE,
  pctColor,
  type FleetMachine,
  type PerfDay,
} from '@/features/performance/perfTypes';

export type MachineSort = 'achievement' | 'name' | 'actual' | 'target';
export type MetricKind = 'location' | 'product';

function readTheme(): { dark: boolean; text: string; muted: string; grid: string; axis: string; tipBg: string } {
  const isPro = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'pro';
  if (isPro) {
    return {
      dark: false,
      text: '#0f172a',
      muted: '#64748b',
      grid: 'rgba(15, 23, 42, 0.08)',
      axis: '#94a3b8',
      tipBg: '#0f2942',
    };
  }
  return {
    dark: true,
    text: '#e2e8f0',
    muted: '#94a3b8',
    grid: 'rgba(148, 163, 184, 0.12)',
    axis: '#64748b',
    tipBg: '#0f172a',
  };
}

function useEcharts(
  optionFactory: () => echarts.EChartsOption | null,
  deps: unknown[],
  heightHint?: number,
): { ref: RefObject<HTMLDivElement>; getChart: () => echarts.ECharts | null } {
  const ref = useRef<HTMLDivElement>(null) as RefObject<HTMLDivElement>;
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const opt = optionFactory();
    if (!opt) {
      chart.clear();
      return;
    }
    chart.setOption(opt, { notMerge: true });
    chart.resize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (heightHint != null && ref.current) {
      ref.current.style.height = `${heightHint}px`;
      chartRef.current?.resize();
    }
  }, [heightHint]);

  return { ref, getChart: () => chartRef.current };
}

function dayLabel(d: PerfDay): string {
  const wd = (d.weekday || '').slice(0, 3);
  const md = d.date.slice(5);
  return wd ? `${wd} ${md}` : md;
}

function sortMachines(
  rows: FleetMachine[],
  sort: MachineSort,
  metric: MetricKind = 'location',
): FleetMachine[] {
  const list = [...rows];
  if (metric === 'product') {
    switch (sort) {
      case 'name':
        list.sort((a, b) => a.machineName.localeCompare(b.machineName));
        break;
      case 'actual':
        list.sort((a, b) => (b.totalProductCups ?? 0) - (a.totalProductCups ?? 0));
        break;
      case 'target':
        list.sort((a, b) => (b.periodProductTargetCups ?? 0) - (a.periodProductTargetCups ?? 0));
        break;
      case 'achievement':
      default:
        list.sort(
          (a, b) =>
            (b.periodProductPctOfTarget ?? -1) - (a.periodProductPctOfTarget ?? -1) ||
            (b.totalProductCups ?? 0) - (a.totalProductCups ?? 0),
        );
        break;
    }
    return list;
  }
  switch (sort) {
    case 'name':
      list.sort((a, b) => a.machineName.localeCompare(b.machineName));
      break;
    case 'actual':
      list.sort((a, b) => b.totalLocationKwd - a.totalLocationKwd);
      break;
    case 'target':
      list.sort((a, b) => (b.periodTargetKd ?? 0) - (a.periodTargetKd ?? 0));
      break;
    case 'achievement':
    default:
      list.sort(
        (a, b) =>
          (b.periodPctOfTarget ?? -1) - (a.periodPctOfTarget ?? -1) ||
          b.totalLocationKwd - a.totalLocationKwd,
      );
      break;
  }
  return list;
}

export function PerfSortToolbar({
  sort,
  onChange,
}: {
  sort: MachineSort;
  onChange: (s: MachineSort) => void;
}) {
  return (
    <div className="perfChartToolbar" role="group" aria-label="Sort machines">
      <span className="perfChartToolbarLabel">Sort</span>
      {(
        [
          ['achievement', 'Achievement'],
          ['actual', 'Actual'],
          ['target', 'Target'],
          ['name', 'Name'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`perfSegPill ${sort === key ? 'active' : ''}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Areas-style horizontal ranking by period % of target. */
export function FleetRankingChart({
  machines,
  sort = 'achievement',
}: {
  machines: FleetMachine[];
  sort?: MachineSort;
}) {
  const rows = useMemo(() => sortMachines(machines, sort), [machines, sort]);
  const height = Math.min(560, Math.max(260, rows.length * 34 + 80));
  const { ref, getChart } = useEcharts(
    () => {
      if (!rows.length) return null;
      const theme = readTheme();
      const names = rows.map((m) => m.machineName);
      const pcts = rows.map((m) => m.periodPctOfTarget ?? 0);
      const axisMax = Math.max(120, ...pcts.map((p) => Math.ceil(p / 5) * 5));
      const needZoom = rows.length > 10;
      const zoomEnd = needZoom ? Math.round((10 / rows.length) * 100) : 100;
      return {
        backgroundColor: 'transparent',
        grid: { left: 8, right: 64, top: 16, bottom: needZoom ? 48 : 16, containLabel: true },
        dataZoom: needZoom
          ? [
              {
                type: 'slider',
                yAxisIndex: 0,
                right: 4,
                width: 14,
                start: 0,
                end: zoomEnd,
                brushSelect: false,
              },
              { type: 'inside', yAxisIndex: 0, start: 0, end: zoomEnd },
            ]
          : [],
        xAxis: {
          type: 'value',
          max: axisMax,
          axisLabel: { formatter: '{value}%', color: theme.muted, fontSize: 11 },
          splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        },
        yAxis: {
          type: 'category',
          data: names,
          inverse: true,
          axisLabel: {
            color: theme.text,
            fontSize: 11,
            fontWeight: 600,
            width: 160,
            overflow: 'truncate',
          },
          axisTick: { show: false },
          axisLine: { show: false },
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 16,
            data: pcts.map((p, i) => ({
              value: p,
              itemStyle: { color: pctColor(rows[i]?.periodPctOfTarget), borderRadius: [0, 4, 4, 0] },
            })),
            label: {
              show: rows.length <= 14,
              position: 'right',
              formatter: '{c}%',
              color: theme.muted,
              fontWeight: 700,
              fontSize: 11,
            },
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: theme.axis, type: 'dashed', width: 1 },
              label: { formatter: '100%', color: theme.muted, fontSize: 10 },
              data: [{ xAxis: 100 }],
            },
          },
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: theme.tipBg,
          borderWidth: 0,
          textStyle: { color: '#e8f4fc', fontSize: 12 },
          formatter: (params: unknown) => {
            const i = (params as { dataIndex?: number }[])[0]?.dataIndex ?? 0;
            const m = rows[i];
            if (!m) return '';
            const tgt = m.periodTargetKd ?? 0;
            const gap = tgt > 0 ? m.totalLocationKwd - tgt : null;
            return [
              `<strong>${m.machineName}</strong>`,
              `Period: ${formatKwd(m.totalLocationKwd)}`,
              `Target: ${tgt > 0 ? formatKwd(tgt) : '—'}`,
              `Achievement: ${m.periodPctOfTarget != null ? `${m.periodPctOfTarget}%` : '—'}`,
              gap != null ? `Gap: ${formatKwd(gap)}` : null,
              m.locationSxPct != null
                ? `SX: ${formatSalesTrendPct(m.locationSxPct).replace(/%$/, ' pts')}`
                : null,
            ]
              .filter(Boolean)
              .join('<br/>');
          },
        },
      } as echarts.EChartsOption;
    },
    [rows],
    height,
  );

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-ranking']));
  }, [getChart]);

  if (!rows.length) return <p className="perfMuted">Select locations to rank.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div ref={ref} className="perfEchart perfEchartRank" role="img" aria-label="Achievement ranking" />
    </ChartExportWrap>
  );
}

/** Targets Areas MachinesKdChart — period target vs actual KD by machine. */
export function FleetTargetActualChart({
  machines,
  sort = 'achievement',
}: {
  machines: FleetMachine[];
  sort?: MachineSort;
}) {
  const ranked = useMemo(() => sortMachines(machines, sort), [machines, sort]);
  const height = Math.min(560, Math.max(260, ranked.length * 34 + 80));
  const { ref, getChart } = useEcharts(
    () => {
      if (!ranked.length) return null;
      const theme = readTheme();
      const names = ranked.map((m) => m.machineName);
      const targets = ranked.map((m) => m.periodTargetKd ?? 0);
      const actuals = ranked.map((m) => m.totalLocationKwd);
      const maxKd = Math.max(1, ...targets, ...actuals);
      const needZoom = ranked.length > 10;
      const zoomEnd = needZoom ? Math.round((10 / ranked.length) * 100) : 100;
      return {
        backgroundColor: 'transparent',
        grid: { left: 8, right: 24, top: 44, bottom: needZoom ? 48 : 16, containLabel: true },
        legend: {
          top: 0,
          data: ['Period target', 'Period actual'],
          textStyle: { fontSize: 11, color: theme.muted },
        },
        dataZoom: needZoom
          ? [
              {
                type: 'slider',
                yAxisIndex: 0,
                right: 4,
                width: 14,
                start: 0,
                end: zoomEnd,
                brushSelect: false,
              },
              { type: 'inside', yAxisIndex: 0, start: 0, end: zoomEnd },
            ]
          : [],
        xAxis: {
          type: 'value',
          max: Math.ceil(maxKd * 1.12),
          axisLabel: { formatter: (v: number) => `${v} KD`, color: theme.muted, fontSize: 10 },
          splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        },
        yAxis: {
          type: 'category',
          data: names,
          inverse: true,
          axisLabel: {
            color: theme.text,
            fontSize: 11,
            fontWeight: 600,
            width: 160,
            overflow: 'truncate',
          },
          axisTick: { show: false },
          axisLine: { show: false },
        },
        series: [
          {
            name: 'Period target',
            type: 'bar',
            barGap: '20%',
            barMaxWidth: 14,
            data: targets,
            itemStyle: { color: theme.dark ? '#475569' : '#cbd5e1', borderRadius: [0, 3, 3, 0] },
            z: 1,
          },
          {
            name: 'Period actual',
            type: 'bar',
            barMaxWidth: 14,
            data: actuals.map((v, i) => ({
              value: v,
              itemStyle: {
                color: pctColor(ranked[i]?.periodPctOfTarget ?? null),
                borderRadius: [0, 3, 3, 0],
              },
            })),
            label: {
              show: ranked.length <= 14,
              position: 'right',
              formatter: (p: { dataIndex?: number }) => {
                const m = ranked[p.dataIndex ?? 0];
                return m?.periodPctOfTarget != null ? `${m.periodPctOfTarget}%` : '';
              },
              fontSize: 10,
              fontWeight: 700,
              color: theme.muted,
            },
            z: 2,
          },
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: theme.tipBg,
          borderWidth: 0,
          textStyle: { color: '#e8f4fc', fontSize: 12 },
          formatter: (params: unknown) => {
            const arr = params as { dataIndex?: number }[];
            const i = arr[0]?.dataIndex ?? 0;
            const m = ranked[i];
            if (!m) return '';
            const target = m.periodTargetKd ?? 0;
            return [
              `<strong>${m.machineName}</strong>`,
              `${m.machineId}`,
              `Target: ${target > 0 ? formatKwd(target) : '—'}`,
              `Actual: ${formatKwd(m.totalLocationKwd)}`,
              `Achievement: ${m.periodPctOfTarget != null ? `${m.periodPctOfTarget}%` : '—'}`,
              target > 0 ? `Gap: ${formatKwd(m.totalLocationKwd - target)}` : '',
            ]
              .filter(Boolean)
              .join('<br/>');
          },
        },
      } as echarts.EChartsOption;
    },
    [ranked],
    height,
  );

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-target-actual']));
  }, [getChart]);

  if (!ranked.length) return <p className="perfMuted">No machines to chart.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div
        ref={ref}
        className="perfEchart perfEchartRank"
        role="img"
        aria-label="Period target vs actual by machine"
      />
    </ChartExportWrap>
  );
}

/** Targets Areas DailyRevenueChart — daily bars + target + optional cumulative. */
export function FleetDailyRevenueChart({
  days,
  showCumulative,
}: {
  days: PerfDay[];
  showCumulative: boolean;
}) {
  const labels = useMemo(() => days.map((d) => dayLabel(d)), [days]);
  const actuals = useMemo(() => days.map((d) => Number(d.locationKwd) || 0), [days]);
  const targets = useMemo(() => days.map((d) => Number(d.locationTargetKd) || 0), [days]);
  const dailyTargetAvg = useMemo(() => {
    const withT = targets.filter((t) => t > 0);
    if (!withT.length) return 0;
    return withT.reduce((a, b) => a + b, 0) / withT.length;
  }, [targets]);

  const cumulativeActual = useMemo(() => {
    const out: number[] = [];
    let run = 0;
    for (const v of actuals) {
      run += v;
      out.push(Math.round(run * 100) / 100);
    }
    return out;
  }, [actuals]);

  const cumulativeTarget = useMemo(() => {
    const out: number[] = [];
    let run = 0;
    for (const t of targets) {
      run += t > 0 ? t : dailyTargetAvg;
      out.push(Math.round(run * 100) / 100);
    }
    return out;
  }, [targets, dailyTargetAvg]);

  const { ref, getChart } = useEcharts(() => {
    if (!days.length) return null;
    const theme = readTheme();
    const maxBar = Math.max(1, dailyTargetAvg, ...actuals, ...targets);
    const maxCum = Math.max(1, ...cumulativeTarget, ...cumulativeActual);
    const series: echarts.SeriesOption[] = [
      {
        name: 'Daily actual',
        type: 'bar',
        data: actuals.map((v, i) => {
          const tgt = targets[i] || dailyTargetAvg;
          return {
            value: Math.round(v * 100) / 100,
            itemStyle: {
              color: tgt > 0 && v >= tgt ? '#15803d' : v > 0 ? '#2563eb' : theme.dark ? '#334155' : '#cbd5e1',
              borderRadius: [4, 4, 0, 0],
            },
          };
        }),
        barMaxWidth: 48,
        yAxisIndex: 0,
      },
      {
        name: 'Daily target',
        type: 'line',
        data: days.map((_, i) => (targets[i] > 0 ? targets[i] : dailyTargetAvg)),
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#94a3b8', type: 'dashed', width: 2 },
        itemStyle: { color: '#94a3b8' },
        yAxisIndex: 0,
      },
    ];
    if (showCumulative) {
      series.push(
        {
          name: 'Cumulative actual',
          type: 'line',
          data: cumulativeActual,
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { color: '#1d4ed8', width: 2.5 },
          itemStyle: { color: '#1d4ed8' },
          yAxisIndex: 1,
        },
        {
          name: 'Cumulative target',
          type: 'line',
          data: cumulativeTarget,
          smooth: true,
          symbol: 'emptyCircle',
          symbolSize: 6,
          lineStyle: { color: '#b45309', type: 'dotted', width: 2 },
          itemStyle: { color: '#b45309' },
          yAxisIndex: 1,
        },
      );
    }
    return {
      backgroundColor: 'transparent',
      grid: { left: 8, right: showCumulative ? 56 : 16, top: 48, bottom: 36, containLabel: true },
      legend: {
        top: 0,
        type: 'scroll',
        textStyle: { fontSize: 11, color: theme.muted },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: theme.muted,
          fontSize: 11,
          fontWeight: 600,
          rotate: labels.length > 14 ? 35 : 0,
        },
        axisTick: { alignWithLabel: true },
      },
      yAxis: [
        {
          type: 'value',
          name: 'KD / day',
          nameTextStyle: { color: theme.muted, fontSize: 10 },
          max: Math.ceil(maxBar * 1.2),
          axisLabel: { formatter: '{value}', color: theme.muted, fontSize: 10 },
          splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        },
        ...(showCumulative
          ? [
              {
                type: 'value' as const,
                name: 'KD cumulative',
                nameTextStyle: { color: theme.muted, fontSize: 10 },
                max: Math.ceil(maxCum * 1.15),
                axisLabel: { formatter: '{value}', color: theme.muted, fontSize: 10 },
                splitLine: { show: false },
              },
            ]
          : []),
      ],
      series,
      tooltip: {
        trigger: 'axis',
        backgroundColor: theme.tipBg,
        borderWidth: 0,
        textStyle: { color: '#e8f4fc', fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { dataIndex?: number }[];
          const i = arr[0]?.dataIndex ?? 0;
          const actual = actuals[i] ?? 0;
          const tgt = targets[i] > 0 ? targets[i] : dailyTargetAvg;
          const lines = [`<strong>${labels[i]}</strong>`, `${days[i]?.date || ''}`];
          lines.push(`Daily actual: ${formatKwd(actual)}`);
          if (tgt > 0) {
            lines.push(`Daily target: ${formatKwd(tgt)}`);
            lines.push(`Gap: ${formatKwd(actual - tgt)}`);
          }
          if (showCumulative) {
            lines.push(`Period-to-date: ${formatKwd(cumulativeActual[i] ?? 0)}`);
            lines.push(`Target pace: ${formatKwd(cumulativeTarget[i] ?? 0)}`);
          }
          return lines.join('<br/>');
        },
      },
    } as echarts.EChartsOption;
  }, [days, labels, actuals, targets, dailyTargetAvg, showCumulative, cumulativeActual, cumulativeTarget]);

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-daily-revenue']));
  }, [getChart]);

  if (!days.length) return <p className="perfMuted">No business days in this period.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div ref={ref} className="perfEchart perfEchartDaily" role="img" aria-label="Daily revenue chart" />
    </ChartExportWrap>
  );
}

/** Period product cups target vs actual by machine. */
export function FleetProductTargetActualChart({
  machines,
  sort = 'achievement',
}: {
  machines: FleetMachine[];
  sort?: MachineSort;
}) {
  const ranked = useMemo(() => sortMachines(machines, sort, 'product'), [machines, sort]);
  const height = Math.min(560, Math.max(260, ranked.length * 34 + 80));
  const { ref, getChart } = useEcharts(
    () => {
      if (!ranked.length) return null;
      const theme = readTheme();
      const names = ranked.map((m) => m.machineName);
      const targets = ranked.map((m) => m.periodProductTargetCups ?? 0);
      const actuals = ranked.map((m) => m.totalProductCups ?? 0);
      const maxCups = Math.max(1, ...targets, ...actuals);
      const needZoom = ranked.length > 10;
      const zoomEnd = needZoom ? Math.round((10 / ranked.length) * 100) : 100;
      return {
        backgroundColor: 'transparent',
        grid: { left: 8, right: 24, top: 44, bottom: needZoom ? 48 : 16, containLabel: true },
        legend: {
          top: 0,
          data: ['Period target', 'Period actual'],
          textStyle: { fontSize: 11, color: theme.muted },
        },
        dataZoom: needZoom
          ? [
              {
                type: 'slider',
                yAxisIndex: 0,
                right: 4,
                width: 14,
                start: 0,
                end: zoomEnd,
                brushSelect: false,
              },
              { type: 'inside', yAxisIndex: 0, start: 0, end: zoomEnd },
            ]
          : [],
        xAxis: {
          type: 'value',
          max: Math.ceil(maxCups * 1.12),
          axisLabel: { formatter: (v: number) => `${v}`, color: theme.muted, fontSize: 10 },
          splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        },
        yAxis: {
          type: 'category',
          data: names,
          inverse: true,
          axisLabel: {
            color: theme.text,
            fontSize: 11,
            fontWeight: 600,
            width: 160,
            overflow: 'truncate',
          },
          axisTick: { show: false },
          axisLine: { show: false },
        },
        series: [
          {
            name: 'Period target',
            type: 'bar',
            barGap: '20%',
            barMaxWidth: 14,
            data: targets,
            itemStyle: { color: theme.dark ? '#475569' : '#cbd5e1', borderRadius: [0, 3, 3, 0] },
            z: 1,
          },
          {
            name: 'Period actual',
            type: 'bar',
            barMaxWidth: 14,
            data: actuals.map((v, i) => ({
              value: v,
              itemStyle: {
                color: pctColor(ranked[i]?.periodProductPctOfTarget ?? null),
                borderRadius: [0, 3, 3, 0],
              },
            })),
            label: {
              show: ranked.length <= 14,
              position: 'right',
              formatter: (p: { dataIndex?: number }) => {
                const m = ranked[p.dataIndex ?? 0];
                return m?.periodProductPctOfTarget != null ? `${m.periodProductPctOfTarget}%` : '';
              },
              fontSize: 10,
              fontWeight: 700,
              color: theme.muted,
            },
            z: 2,
          },
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: theme.tipBg,
          borderWidth: 0,
          textStyle: { color: '#e8f4fc', fontSize: 12 },
          formatter: (params: unknown) => {
            const arr = params as { dataIndex?: number }[];
            const i = arr[0]?.dataIndex ?? 0;
            const m = ranked[i];
            if (!m) return '';
            const target = m.periodProductTargetCups ?? 0;
            const actual = m.totalProductCups ?? 0;
            return [
              `<strong>${m.machineName}</strong>`,
              m.productName ? `Product: ${m.productName}` : null,
              `Target: ${target > 0 ? `${Math.round(target)} cups` : '—'}`,
              `Actual: ${Math.round(actual)} cups`,
              `Achievement: ${m.periodProductPctOfTarget != null ? `${m.periodProductPctOfTarget}%` : '—'}`,
              target > 0 ? `Gap: ${Math.round(actual - target)} cups` : '',
            ]
              .filter(Boolean)
              .join('<br/>');
          },
        },
      } as echarts.EChartsOption;
    },
    [ranked],
    height,
  );

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-product-target-actual']));
  }, [getChart]);

  if (!ranked.length) return <p className="perfMuted">No machines to chart.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div
        ref={ref}
        className="perfEchart perfEchartRank"
        role="img"
        aria-label="Period product target vs actual by machine"
      />
    </ChartExportWrap>
  );
}

/** Achievement ranking by period product cups vs target. */
export function FleetProductRankingChart({
  machines,
  sort = 'achievement',
}: {
  machines: FleetMachine[];
  sort?: MachineSort;
}) {
  const rows = useMemo(() => sortMachines(machines, sort, 'product'), [machines, sort]);
  const height = Math.min(560, Math.max(260, rows.length * 34 + 80));
  const { ref, getChart } = useEcharts(
    () => {
      if (!rows.length) return null;
      const theme = readTheme();
      const names = rows.map((m) => m.machineName);
      const pcts = rows.map((m) => m.periodProductPctOfTarget ?? 0);
      const axisMax = Math.max(120, ...pcts.map((p) => Math.ceil(p / 5) * 5));
      const needZoom = rows.length > 10;
      const zoomEnd = needZoom ? Math.round((10 / rows.length) * 100) : 100;
      return {
        backgroundColor: 'transparent',
        grid: { left: 8, right: 64, top: 16, bottom: needZoom ? 48 : 16, containLabel: true },
        dataZoom: needZoom
          ? [
              {
                type: 'slider',
                yAxisIndex: 0,
                right: 4,
                width: 14,
                start: 0,
                end: zoomEnd,
                brushSelect: false,
              },
              { type: 'inside', yAxisIndex: 0, start: 0, end: zoomEnd },
            ]
          : [],
        xAxis: {
          type: 'value',
          max: axisMax,
          axisLabel: { formatter: '{value}%', color: theme.muted, fontSize: 11 },
          splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        },
        yAxis: {
          type: 'category',
          data: names,
          inverse: true,
          axisLabel: {
            color: theme.text,
            fontSize: 11,
            fontWeight: 600,
            width: 160,
            overflow: 'truncate',
          },
          axisTick: { show: false },
          axisLine: { show: false },
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 16,
            data: pcts.map((p, i) => ({
              value: p,
              itemStyle: {
                color: pctColor(rows[i]?.periodProductPctOfTarget),
                borderRadius: [0, 4, 4, 0],
              },
            })),
            label: {
              show: rows.length <= 14,
              position: 'right',
              formatter: '{c}%',
              color: theme.muted,
              fontWeight: 700,
              fontSize: 11,
            },
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: theme.axis, type: 'dashed', width: 1 },
              label: { formatter: '100%', color: theme.muted, fontSize: 10 },
              data: [{ xAxis: 100 }],
            },
          },
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: theme.tipBg,
          borderWidth: 0,
          textStyle: { color: '#e8f4fc', fontSize: 12 },
          formatter: (params: unknown) => {
            const i = (params as { dataIndex?: number }[])[0]?.dataIndex ?? 0;
            const m = rows[i];
            if (!m) return '';
            const tgt = m.periodProductTargetCups ?? 0;
            const actual = m.totalProductCups ?? 0;
            return [
              `<strong>${m.machineName}</strong>`,
              m.productName ? `Product: ${m.productName}` : null,
              `Period: ${Math.round(actual)} cups`,
              `Target: ${tgt > 0 ? `${Math.round(tgt)} cups` : '—'}`,
              `Achievement: ${m.periodProductPctOfTarget != null ? `${m.periodProductPctOfTarget}%` : '—'}`,
            ]
              .filter(Boolean)
              .join('<br/>');
          },
        },
      } as echarts.EChartsOption;
    },
    [rows],
    height,
  );

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-product-ranking']));
  }, [getChart]);

  if (!rows.length) return <p className="perfMuted">Select locations to rank.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div
        ref={ref}
        className="perfEchart perfEchartRank"
        role="img"
        aria-label="Product achievement ranking"
      />
    </ChartExportWrap>
  );
}

/** Daily product cups bars + target + optional cumulative. */
export function FleetDailyProductChart({
  days,
  showCumulative,
  productLabel,
}: {
  days: PerfDay[];
  showCumulative: boolean;
  productLabel?: string;
}) {
  const labels = useMemo(() => days.map((d) => dayLabel(d)), [days]);
  const actuals = useMemo(() => days.map((d) => Number(d.productCups) || 0), [days]);
  const targets = useMemo(() => days.map((d) => Number(d.productTargetCups) || 0), [days]);
  const dailyTargetAvg = useMemo(() => {
    const withT = targets.filter((t) => t > 0);
    if (!withT.length) return 0;
    return withT.reduce((a, b) => a + b, 0) / withT.length;
  }, [targets]);

  const cumulativeActual = useMemo(() => {
    const out: number[] = [];
    let run = 0;
    for (const v of actuals) {
      run += v;
      out.push(run);
    }
    return out;
  }, [actuals]);

  const cumulativeTarget = useMemo(() => {
    const out: number[] = [];
    let run = 0;
    for (const t of targets) {
      run += t > 0 ? t : dailyTargetAvg;
      out.push(Math.round(run * 100) / 100);
    }
    return out;
  }, [targets, dailyTargetAvg]);

  const { ref, getChart } = useEcharts(() => {
    if (!days.length) return null;
    const theme = readTheme();
    const maxBar = Math.max(1, dailyTargetAvg, ...actuals, ...targets);
    const maxCum = Math.max(1, ...cumulativeTarget, ...cumulativeActual);
    const series: echarts.SeriesOption[] = [
      {
        name: 'Daily cups',
        type: 'bar',
        data: actuals.map((v, i) => {
          const tgt = targets[i] || dailyTargetAvg;
          return {
            value: Math.round(v),
            itemStyle: {
              color: tgt > 0 && v >= tgt ? '#15803d' : v > 0 ? '#0369a1' : theme.dark ? '#334155' : '#cbd5e1',
              borderRadius: [4, 4, 0, 0],
            },
          };
        }),
        barMaxWidth: 48,
        yAxisIndex: 0,
      },
      {
        name: 'Daily target',
        type: 'line',
        data: days.map((_, i) => (targets[i] > 0 ? targets[i] : dailyTargetAvg)),
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#94a3b8', type: 'dashed', width: 2 },
        itemStyle: { color: '#94a3b8' },
        yAxisIndex: 0,
      },
    ];
    if (showCumulative) {
      series.push(
        {
          name: 'Cumulative cups',
          type: 'line',
          data: cumulativeActual,
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { color: '#0284c7', width: 2.5 },
          itemStyle: { color: '#0284c7' },
          yAxisIndex: 1,
        },
        {
          name: 'Cumulative target',
          type: 'line',
          data: cumulativeTarget,
          smooth: true,
          symbol: 'emptyCircle',
          symbolSize: 6,
          lineStyle: { color: '#b45309', type: 'dotted', width: 2 },
          itemStyle: { color: '#b45309' },
          yAxisIndex: 1,
        },
      );
    }
    return {
      backgroundColor: 'transparent',
      grid: { left: 8, right: showCumulative ? 56 : 16, top: 48, bottom: 36, containLabel: true },
      legend: {
        top: 0,
        type: 'scroll',
        textStyle: { fontSize: 11, color: theme.muted },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: theme.muted,
          fontSize: 11,
          fontWeight: 600,
          rotate: labels.length > 14 ? 35 : 0,
        },
        axisTick: { alignWithLabel: true },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Cups / day',
          nameTextStyle: { color: theme.muted, fontSize: 10 },
          max: Math.ceil(maxBar * 1.2),
          axisLabel: { formatter: '{value}', color: theme.muted, fontSize: 10 },
          splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        },
        ...(showCumulative
          ? [
              {
                type: 'value' as const,
                name: 'Cups cumulative',
                nameTextStyle: { color: theme.muted, fontSize: 10 },
                max: Math.ceil(maxCum * 1.15),
                axisLabel: { formatter: '{value}', color: theme.muted, fontSize: 10 },
                splitLine: { show: false },
              },
            ]
          : []),
      ],
      series,
      tooltip: {
        trigger: 'axis',
        backgroundColor: theme.tipBg,
        borderWidth: 0,
        textStyle: { color: '#e8f4fc', fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { dataIndex?: number }[];
          const i = arr[0]?.dataIndex ?? 0;
          const actual = actuals[i] ?? 0;
          const tgt = targets[i] > 0 ? targets[i] : dailyTargetAvg;
          const lines = [
            `<strong>${labels[i]}</strong>`,
            `${days[i]?.date || ''}`,
            productLabel ? `Product: ${productLabel}` : null,
          ].filter(Boolean) as string[];
          lines.push(`Daily cups: ${Math.round(actual)}`);
          if (tgt > 0) {
            lines.push(`Daily target: ${Math.round(tgt)}`);
            lines.push(`Gap: ${Math.round(actual - tgt)}`);
          }
          if (showCumulative) {
            lines.push(`Period-to-date: ${Math.round(cumulativeActual[i] ?? 0)}`);
            lines.push(`Target pace: ${Math.round(cumulativeTarget[i] ?? 0)}`);
          }
          return lines.join('<br/>');
        },
      },
    } as echarts.EChartsOption;
  }, [
    days,
    labels,
    actuals,
    targets,
    dailyTargetAvg,
    showCumulative,
    cumulativeActual,
    cumulativeTarget,
    productLabel,
  ]);

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-daily-product']));
  }, [getChart]);

  if (!days.length) return <p className="perfMuted">No business days in this period.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div ref={ref} className="perfEchart perfEchartDaily" role="img" aria-label="Daily product cups chart" />
    </ChartExportWrap>
  );
}

/** Multi-series daily KD overlay (compare selected machines). */
export function FleetCompareChart({ machines }: { machines: FleetMachine[] }) {
  const limited = useMemo(() => machines.slice(0, 12), [machines]);
  const labels = useMemo(() => {
    const first = limited[0]?.days || [];
    return first.map((d) => dayLabel(d));
  }, [limited]);

  const { ref, getChart } = useEcharts(() => {
    if (!limited.length || !labels.length) return null;
    const theme = readTheme();
    return {
      backgroundColor: 'transparent',
      animationDuration: 400,
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: theme.tipBg,
        borderWidth: 0,
        textStyle: { color: '#e8f4fc', fontSize: 12 },
        valueFormatter: (v: unknown) =>
          v == null || !Number.isFinite(Number(v)) ? '—' : formatKwd(Number(v)),
      },
      legend: {
        type: 'scroll',
        top: 2,
        textStyle: { color: theme.muted, fontSize: 11 },
      },
      grid: { left: 52, right: 16, top: 48, bottom: 44 },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLabel: { color: theme.muted, fontSize: 10, rotate: labels.length > 14 ? 35 : 0 },
        axisLine: { lineStyle: { color: theme.axis } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'KD',
        nameTextStyle: { color: theme.muted, fontSize: 11 },
        axisLabel: {
          color: theme.muted,
          fontSize: 10,
          formatter: (v: number) => (v >= 10 ? `${Math.round(v)}` : v.toFixed(1)),
        },
        splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        axisLine: { show: false },
      },
      series: limited.map((m, i) => {
        const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
        return {
          name: m.machineName,
          type: 'line',
          smooth: 0.2,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2.25, color },
          itemStyle: { color },
          data: (m.days || []).map((d) => Number(d.locationKwd) || 0),
        };
      }),
    } as echarts.EChartsOption;
  }, [limited, labels]);

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-compare']));
  }, [getChart]);

  if (!limited.length) return <p className="perfMuted">Select locations to compare.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div ref={ref} className="perfEchart" role="img" aria-label="Revenue compare by location" />
    </ChartExportWrap>
  );
}

/** Stacked achieved + remaining for one day series (single or aggregate). */
export function RevenueTrajectoryChart({ days, title }: { days: PerfDay[]; title?: string }) {
  const seriesData = useMemo(
    () =>
      days.map((d) => {
        const actual = Number(d.locationKwd) || 0;
        const target = Number(d.locationTargetKd) || 0;
        const remain = target > 0 ? Math.max(0, target - actual) : 0;
        return {
          label: dayLabel(d),
          date: d.date,
          actual,
          target,
          remain,
          pct: d.locationPctOfTarget,
          growth: d.locationGrowthPct,
        };
      }),
    [days],
  );

  const { ref, getChart } = useEcharts(() => {
    if (!seriesData.length) return null;
    const theme = readTheme();
    const labels = seriesData.map((r) => r.label);
    const hasTarget = seriesData.some((r) => r.target > 0);
    return {
      backgroundColor: 'transparent',
      animationDuration: 450,
      title: title
        ? { text: title, left: 8, top: 0, textStyle: { color: theme.muted, fontSize: 12, fontWeight: 600 } }
        : undefined,
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: theme.tipBg,
        borderWidth: 0,
        textStyle: { color: '#e8f4fc', fontSize: 12 },
        formatter: (params: unknown) => {
          const idx = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          const row = seriesData[idx];
          if (!row) return '';
          const lines = [`<strong>${row.label}</strong> · ${row.date}`, `Achieved: ${formatKwd(row.actual)}`];
          if (row.target > 0) {
            lines.push(`Target: ${formatKwd(row.target)}`);
            lines.push(`Remaining: ${formatKwd(row.remain)}`);
            if (row.pct != null) lines.push(`Of target: ${row.pct}%`);
          }
          if (row.growth != null) lines.push(`Day growth: ${formatSalesTrendPct(row.growth)}`);
          return lines.join('<br/>');
        },
      },
      legend: {
        top: title ? 22 : 4,
        right: 8,
        textStyle: { color: theme.muted, fontSize: 11 },
        data: hasTarget ? ['Achieved', 'Remaining to target', 'Daily target'] : ['Achieved'],
      },
      grid: { left: 52, right: 18, top: title ? 56 : 40, bottom: 42 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: theme.muted, fontSize: 10, rotate: labels.length > 12 ? 35 : 0 },
        axisLine: { lineStyle: { color: theme.axis } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'KD',
        nameTextStyle: { color: theme.muted, fontSize: 11 },
        axisLabel: {
          color: theme.muted,
          fontSize: 10,
          formatter: (v: number) => (v >= 10 ? `${Math.round(v)}` : v.toFixed(1)),
        },
        splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        axisLine: { show: false },
      },
      series: [
        {
          name: 'Achieved',
          type: 'bar',
          stack: 'rev',
          barMaxWidth: 28,
          data: seriesData.map((r) => Number(r.actual.toFixed(3))),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#2dd4bf' },
              { offset: 1, color: '#0f766e' },
            ]),
          },
        },
        ...(hasTarget
          ? ([
              {
                name: 'Remaining to target',
                type: 'bar',
                stack: 'rev',
                barMaxWidth: 28,
                data: seriesData.map((r) => Number(r.remain.toFixed(3))),
                itemStyle: {
                  color: theme.dark ? 'rgba(100, 116, 139, 0.45)' : 'rgba(148, 163, 184, 0.45)',
                  borderColor: theme.dark ? 'rgba(148, 163, 184, 0.55)' : 'rgba(100, 116, 139, 0.5)',
                  borderWidth: 1,
                  borderType: 'dashed' as const,
                },
              },
              {
                name: 'Daily target',
                type: 'line',
                data: seriesData.map((r) => Number(r.target.toFixed(3))),
                symbol: 'circle',
                symbolSize: 5,
                lineStyle: { width: 2, type: 'dashed', color: '#f59e0b' },
                itemStyle: { color: '#f59e0b' },
                z: 5,
              },
            ] as echarts.SeriesOption[])
          : []),
      ],
    } as echarts.EChartsOption;
  }, [seriesData, title]);

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-trajectory']));
  }, [getChart]);

  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div ref={ref} className="perfEchart" role="img" aria-label="Revenue Trajectory" />
    </ChartExportWrap>
  );
}

export function ProductTrajectoryChart({ days, productName }: { days: PerfDay[]; productName: string }) {
  const seriesData = useMemo(
    () =>
      days.map((d) => {
        const actual = Number(d.productCups) || 0;
        const target = Number(d.productTargetCups) || 0;
        const remain = target > 0 ? Math.max(0, target - actual) : 0;
        return {
          label: dayLabel(d),
          date: d.date,
          actual,
          target,
          remain,
          pct: d.productPctOfTarget,
          growth: d.productGrowthPct,
        };
      }),
    [days],
  );

  const { ref, getChart } = useEcharts(() => {
    if (!seriesData.length) return null;
    const theme = readTheme();
    const labels = seriesData.map((r) => r.label);
    const hasTarget = seriesData.some((r) => r.target > 0);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: theme.tipBg,
        borderWidth: 0,
        textStyle: { color: '#e8f4fc', fontSize: 12 },
        formatter: (params: unknown) => {
          const idx = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          const row = seriesData[idx];
          if (!row) return '';
          const lines = [
            `<strong>${row.label}</strong> · ${row.date}`,
            `${productName}: ${Math.round(row.actual)} cups`,
          ];
          if (row.target > 0) {
            lines.push(`Target: ${Math.round(row.target)} cups`);
            lines.push(`Remaining: ${Math.round(row.remain)} cups`);
          }
          return lines.join('<br/>');
        },
      },
      legend: {
        top: 4,
        right: 8,
        textStyle: { color: theme.muted, fontSize: 11 },
        data: hasTarget ? ['Cups sold', 'Remaining to target', 'Cup target'] : ['Cups sold'],
      },
      grid: { left: 52, right: 18, top: 40, bottom: 42 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: theme.muted, fontSize: 10, rotate: labels.length > 12 ? 35 : 0 },
        axisLine: { lineStyle: { color: theme.axis } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Cups',
        nameTextStyle: { color: theme.muted, fontSize: 11 },
        minInterval: 1,
        axisLabel: { color: theme.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        axisLine: { show: false },
      },
      series: [
        {
          name: 'Cups sold',
          type: 'bar',
          stack: 'prod',
          barMaxWidth: 28,
          data: seriesData.map((r) => r.actual),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#38bdf8' },
              { offset: 1, color: '#0369a1' },
            ]),
          },
        },
        ...(hasTarget
          ? ([
              {
                name: 'Remaining to target',
                type: 'bar',
                stack: 'prod',
                barMaxWidth: 28,
                data: seriesData.map((r) => r.remain),
                itemStyle: {
                  color: theme.dark ? 'rgba(100, 116, 139, 0.45)' : 'rgba(148, 163, 184, 0.45)',
                  borderType: 'dashed' as const,
                  borderWidth: 1,
                },
              },
              {
                name: 'Cup target',
                type: 'line',
                data: seriesData.map((r) => r.target),
                symbol: 'circle',
                symbolSize: 5,
                lineStyle: { width: 2, type: 'dashed', color: '#a78bfa' },
                itemStyle: { color: '#a78bfa' },
              },
            ] as echarts.SeriesOption[])
          : []),
      ],
    } as echarts.EChartsOption;
  }, [seriesData, productName]);

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-product']));
  }, [getChart]);

  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div ref={ref} className="perfEchart" role="img" aria-label={`Product Trajectory ${productName}`} />
    </ChartExportWrap>
  );
}

export function GrowthRateChart({ days }: { days: PerfDay[] }) {
  const seriesData = useMemo(
    () =>
      days.map((d) => ({
        label: dayLabel(d),
        loc: d.locationGrowthPct,
        prod: d.productGrowthPct,
      })),
    [days],
  );

  const { ref, getChart } = useEcharts(() => {
    if (!seriesData.length) return null;
    const theme = readTheme();
    const labels = seriesData.map((r) => r.label);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: theme.tipBg,
        borderWidth: 0,
        textStyle: { color: '#e8f4fc', fontSize: 12 },
        valueFormatter: (v: unknown) =>
          v == null || !Number.isFinite(Number(v)) ? '—' : formatSalesTrendPct(Number(v)),
      },
      legend: {
        top: 4,
        right: 8,
        textStyle: { color: theme.muted, fontSize: 11 },
        data: ['Location growth', 'Product growth'],
      },
      grid: { left: 52, right: 18, top: 40, bottom: 42 },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLabel: { color: theme.muted, fontSize: 10, rotate: labels.length > 12 ? 35 : 0 },
        axisLine: { lineStyle: { color: theme.axis } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Growth %',
        nameTextStyle: { color: theme.muted, fontSize: 11 },
        axisLabel: { color: theme.muted, fontSize: 10, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } },
        axisLine: { show: false },
      },
      series: [
        {
          name: 'Location growth',
          type: 'line',
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2.5, color: '#2dd4bf' },
          itemStyle: { color: '#2dd4bf' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(45, 212, 191, 0.28)' },
              { offset: 1, color: 'rgba(45, 212, 191, 0.02)' },
            ]),
          },
          data: seriesData.map((r) => (r.loc != null && Number.isFinite(r.loc) ? r.loc : null)),
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: theme.axis, width: 1 },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: 'Product growth',
          type: 'line',
          smooth: 0.25,
          symbol: 'diamond',
          symbolSize: 7,
          lineStyle: { width: 2.5, color: '#38bdf8' },
          itemStyle: { color: '#38bdf8' },
          data: seriesData.map((r) => (r.prod != null && Number.isFinite(r.prod) ? r.prod : null)),
        },
      ],
    } as echarts.EChartsOption;
  }, [seriesData]);

  const onExport = useCallback(() => {
    const c = getChart();
    if (c) downloadChartPng(c, chartFilename(['perf-growth']));
  }, [getChart]);

  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  return (
    <ChartExportWrap onExport={onExport} className="chartExportWrapBlock">
      <div ref={ref} className="perfEchart" role="img" aria-label="Day growth rates" />
    </ChartExportWrap>
  );
}

/** Multi-select overview — Targets Areas detail layout (location + product). */
export function FleetPerformanceOverview({
  machines,
  aggregateDays,
  productLabel,
}: {
  machines: FleetMachine[];
  aggregateDays: PerfDay[];
  productLabel?: string;
}) {
  const [machineSort, setMachineSort] = useState<MachineSort>('achievement');
  const [productSort, setProductSort] = useState<MachineSort>('achievement');
  const [showCumulative, setShowCumulative] = useState(true);
  const [showProductCumulative, setShowProductCumulative] = useState(true);

  const hasProductData = useMemo(
    () =>
      machines.some((m) => (m.totalProductCups ?? 0) > 0 || (m.periodProductTargetCups ?? 0) > 0) ||
      aggregateDays.some((d) => (d.productCups ?? 0) > 0 || (d.productTargetCups ?? 0) > 0),
    [machines, aggregateDays],
  );

  const prodTitle = productLabel ? ` · ${productLabel}` : '';

  if (!machines.length) return null;

  return (
    <section className="perfOverview" aria-labelledby="perf-overview-title">
      <header className="perfOverviewHead">
        <div>
          <h3 id="perf-overview-title" className="perfSectionTitle">
            Performance charts
          </h3>
          <p className="perfSectionHint">
            Location KD and promoted-product cups — target vs actual, ranking, daily + cumulative.
            Same pattern as Targets Areas. PNG export on each chart.
          </p>
        </div>
      </header>

      <h4 className="perfGroupTitle">Location revenue</h4>
      <div className="perfOverviewGrid">
        <article className="perfPanel">
          <div className="perfPanelHead">
            <div>
              <h4 className="perfPanelTitle">Period revenue by machine</h4>
              <p className="perfSectionHint">Gray = target · color = actual · label = achievement %</p>
            </div>
            <PerfSortToolbar sort={machineSort} onChange={setMachineSort} />
          </div>
          <FleetTargetActualChart machines={machines} sort={machineSort} />
        </article>

        <article className="perfPanel">
          <div className="perfPanelHead">
            <div>
              <h4 className="perfPanelTitle">Achievement ranking</h4>
              <p className="perfSectionHint">Period KD vs target — 100% dashed line</p>
            </div>
          </div>
          <FleetRankingChart machines={machines} sort={machineSort} />
        </article>

        <article className="perfPanel perfPanelWide">
          <div className="perfPanelHead">
            <div>
              <h4 className="perfPanelTitle">Daily revenue (selected fleet)</h4>
              <p className="perfSectionHint">
                Sum of selected locations · dashed line = daily target · optional cumulative pace
              </p>
            </div>
            <div className="perfChartToolbar">
              <button
                type="button"
                className={`perfSegPill ${showCumulative ? 'active' : ''}`}
                onClick={() => setShowCumulative((v) => !v)}
              >
                {showCumulative ? 'Cumulative on' : 'Cumulative off'}
              </button>
            </div>
          </div>
          <FleetDailyRevenueChart days={aggregateDays} showCumulative={showCumulative} />
        </article>
      </div>

      <h4 className="perfGroupTitle">Promoted product{prodTitle}</h4>
      {!hasProductData ? (
        <p className="perfMuted">
          Product cups are off by default for speed. Use <strong>Load product cups</strong> in the
          toolbar (or open a single machine for detail charts).
        </p>
      ) : (
        <div className="perfOverviewGrid">
          <article className="perfPanel">
            <div className="perfPanelHead">
              <div>
                <h4 className="perfPanelTitle">Period cups by machine</h4>
                <p className="perfSectionHint">Gray = target · color = actual · label = achievement %</p>
              </div>
              <PerfSortToolbar sort={productSort} onChange={setProductSort} />
            </div>
            <FleetProductTargetActualChart machines={machines} sort={productSort} />
          </article>

          <article className="perfPanel">
            <div className="perfPanelHead">
              <div>
                <h4 className="perfPanelTitle">Product achievement ranking</h4>
                <p className="perfSectionHint">Period cups vs target — 100% dashed line</p>
              </div>
            </div>
            <FleetProductRankingChart machines={machines} sort={productSort} />
          </article>

          <article className="perfPanel perfPanelWide">
            <div className="perfPanelHead">
              <div>
                <h4 className="perfPanelTitle">Daily product cups (selected fleet)</h4>
                <p className="perfSectionHint">
                  Sum of selected locations · dashed = daily cup target · optional cumulative
                </p>
              </div>
              <div className="perfChartToolbar">
                <button
                  type="button"
                  className={`perfSegPill ${showProductCumulative ? 'active' : ''}`}
                  onClick={() => setShowProductCumulative((v) => !v)}
                >
                  {showProductCumulative ? 'Cumulative on' : 'Cumulative off'}
                </button>
              </div>
            </div>
            <FleetDailyProductChart
              days={aggregateDays}
              showCumulative={showProductCumulative}
              productLabel={productLabel}
            />
          </article>
        </div>
      )}
    </section>
  );
}

export type { PerfDay };
