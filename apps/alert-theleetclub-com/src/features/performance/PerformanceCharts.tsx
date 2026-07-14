import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as echarts from 'echarts';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import {
  SERIES_PALETTE,
  pctColor,
  type FleetMachine,
  type PerfDay,
} from '@/features/performance/perfTypes';

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
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
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

  return ref;
}

function dayLabel(d: PerfDay): string {
  const wd = (d.weekday || '').slice(0, 3);
  const md = d.date.slice(5);
  return wd ? `${wd} ${md}` : md;
}

/** Areas-style horizontal ranking by period % of target. */
export function FleetRankingChart({ machines }: { machines: FleetMachine[] }) {
  const rows = useMemo(
    () =>
      [...machines].sort(
        (a, b) => (b.periodPctOfTarget ?? -1) - (a.periodPctOfTarget ?? -1) || b.totalLocationKwd - a.totalLocationKwd,
      ),
    [machines],
  );
  const height = Math.min(520, Math.max(220, rows.length * 30 + 56));
  const ref = useEcharts(
    () => {
      if (!rows.length) return null;
      const theme = readTheme();
      const names = rows.map((m) => m.machineName);
      const pcts = rows.map((m) => m.periodPctOfTarget ?? 0);
      const axisMax = Math.max(120, ...pcts.map((p) => Math.ceil(p / 5) * 5));
      const needZoom = rows.length > 14;
      const zoomEnd = needZoom ? Math.round((14 / rows.length) * 100) : 100;
      return {
        backgroundColor: 'transparent',
        grid: { left: 8, right: 64, top: 16, bottom: needZoom ? 36 : 12, containLabel: true },
        dataZoom: needZoom
          ? [
              { type: 'slider', yAxisIndex: 0, start: 0, end: zoomEnd, brushSelect: false },
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
            width: 140,
            overflow: 'truncate',
          },
          axisTick: { show: false },
          axisLine: { show: false },
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 18,
            data: pcts.map((p, i) => ({
              value: p,
              itemStyle: { color: pctColor(rows[i]?.periodPctOfTarget), borderRadius: [0, 4, 4, 0] },
            })),
            label: {
              show: rows.length <= 18,
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
            return [
              `<strong>${m.machineName}</strong>`,
              `Period: ${formatKwd(m.totalLocationKwd)}`,
              `Target: ${m.periodTargetKd != null ? formatKwd(m.periodTargetKd) : '—'}`,
              `Achievement: ${m.periodPctOfTarget != null ? `${m.periodPctOfTarget}%` : '—'}`,
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

  if (!rows.length) return <p className="perfMuted">Select locations to rank.</p>;
  return <div ref={ref} className="perfEchart perfEchartRank" role="img" aria-label="Achievement ranking" />;
}

/** Multi-series daily KD overlay (compare selected machines). */
export function FleetCompareChart({ machines }: { machines: FleetMachine[] }) {
  const limited = useMemo(() => machines.slice(0, 12), [machines]);
  const labels = useMemo(() => {
    const first = limited[0]?.days || [];
    return first.map((d) => dayLabel(d));
  }, [limited]);

  const ref = useEcharts(() => {
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

  if (!limited.length) return <p className="perfMuted">Select locations to compare.</p>;
  return <div ref={ref} className="perfEchart" role="img" aria-label="Revenue compare by location" />;
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

  const ref = useEcharts(() => {
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

  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  return <div ref={ref} className="perfEchart" role="img" aria-label="Revenue Trajectory" />;
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

  const ref = useEcharts(() => {
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

  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  return <div ref={ref} className="perfEchart" role="img" aria-label={`Product Trajectory ${productName}`} />;
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

  const ref = useEcharts(() => {
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

  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  return <div ref={ref} className="perfEchart" role="img" aria-label="Day growth rates" />;
}

export type { PerfDay };
