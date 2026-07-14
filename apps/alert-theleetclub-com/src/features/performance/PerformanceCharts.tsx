import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as echarts from 'echarts';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';

export type PerfDay = {
  date: string;
  weekday?: string;
  locationKwd: number;
  productCups: number;
  locationTargetKd?: number | null;
  productTargetCups?: number | null;
  locationGrowthPct?: number | null;
  productGrowthPct?: number | null;
  locationPctOfTarget?: number | null;
  productPctOfTarget?: number | null;
};

function readTheme(): { dark: boolean; text: string; muted: string; grid: string; axis: string } {
  const isPro = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'pro';
  if (isPro) {
    return {
      dark: false,
      text: '#0f172a',
      muted: '#64748b',
      grid: 'rgba(15, 23, 42, 0.08)',
      axis: '#94a3b8',
    };
  }
  return {
    dark: true,
    text: '#e2e8f0',
    muted: '#94a3b8',
    grid: 'rgba(148, 163, 184, 0.12)',
    axis: '#64748b',
  };
}

function useEcharts(
  optionFactory: () => echarts.EChartsOption | null,
  deps: unknown[],
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
    // optionFactory + deps intentionally listed by callers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

function dayLabel(d: PerfDay): string {
  const wd = (d.weekday || '').slice(0, 3);
  const md = d.date.slice(5);
  return wd ? `${wd} ${md}` : md;
}

/** Stacked achieved + remaining vs target line — Revenue Trajectory. */
export function RevenueTrajectoryChart({ days }: { days: PerfDay[] }) {
  const seriesData = useMemo(() => {
    return days.map((d) => {
      const actual = Number(d.locationKwd) || 0;
      const target = Number(d.locationTargetKd) || 0;
      const remain = target > 0 ? Math.max(0, target - actual) : 0;
      const over = target > 0 ? Math.max(0, actual - target) : 0;
      return {
        label: dayLabel(d),
        date: d.date,
        actual,
        target,
        remain,
        over,
        pct: d.locationPctOfTarget,
        growth: d.locationGrowthPct,
      };
    });
  }, [days]);

  const ref = useEcharts(() => {
    if (!seriesData.length) return null;
    const theme = readTheme();
    const labels = seriesData.map((r) => r.label);
    const hasTarget = seriesData.some((r) => r.target > 0);
    return {
      backgroundColor: 'transparent',
      animationDuration: 450,
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: theme.dark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.97)',
        borderColor: theme.dark ? '#334155' : '#e2e8f0',
        textStyle: { color: theme.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as Array<{ dataIndex: number; marker: string; seriesName: string; value: number }>;
          const idx = arr[0]?.dataIndex ?? 0;
          const row = seriesData[idx];
          if (!row) return '';
          const lines = [
            `<strong>${row.label}</strong> · ${row.date}`,
            `Achieved: ${formatKwd(row.actual)}`,
          ];
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
        top: 4,
        right: 8,
        textStyle: { color: theme.muted, fontSize: 11 },
        data: hasTarget ? ['Achieved', 'Remaining to target', 'Daily target'] : ['Achieved'],
      },
      grid: { left: 52, right: 18, top: 40, bottom: 42, containLabel: false },
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
        nameTextStyle: { color: theme.muted, fontSize: 11, padding: [0, 0, 0, 8] },
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
            borderRadius: [0, 0, 0, 0],
          },
          emphasis: { focus: 'series' },
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
                emphasis: { focus: 'series' },
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
  }, [seriesData]);

  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  return <div ref={ref} className="perfEchart" role="img" aria-label="Revenue Trajectory" />;
}

/** Product cups vs target. */
export function ProductTrajectoryChart({ days, productName }: { days: PerfDay[]; productName: string }) {
  const seriesData = useMemo(() => {
    return days.map((d) => {
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
    });
  }, [days]);

  const ref = useEcharts(() => {
    if (!seriesData.length) return null;
    const theme = readTheme();
    const labels = seriesData.map((r) => r.label);
    const hasTarget = seriesData.some((r) => r.target > 0);
    return {
      backgroundColor: 'transparent',
      animationDuration: 450,
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: theme.dark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.97)',
        borderColor: theme.dark ? '#334155' : '#e2e8f0',
        textStyle: { color: theme.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as Array<{ dataIndex: number }>;
          const idx = arr[0]?.dataIndex ?? 0;
          const row = seriesData[idx];
          if (!row) return '';
          const lines = [
            `<strong>${row.label}</strong> · ${row.date}`,
            `${productName}: ${Math.round(row.actual)} cups`,
          ];
          if (row.target > 0) {
            lines.push(`Target: ${Math.round(row.target)} cups`);
            lines.push(`Remaining: ${Math.round(row.remain)} cups`);
            if (row.pct != null) lines.push(`Of target: ${row.pct}%`);
          }
          if (row.growth != null) lines.push(`Day growth: ${formatSalesTrendPct(row.growth)}`);
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
                  borderColor: theme.dark ? 'rgba(148, 163, 184, 0.55)' : 'rgba(100, 116, 139, 0.5)',
                  borderWidth: 1,
                  borderType: 'dashed' as const,
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
                z: 5,
              },
            ] as echarts.SeriesOption[])
          : []),
      ],
    } as echarts.EChartsOption;
  }, [seriesData, productName]);

  if (!days.length) return <p className="perfMuted">No days in range.</p>;
  return (
    <div
      ref={ref}
      className="perfEchart"
      role="img"
      aria-label={`Product Trajectory ${productName}`}
    />
  );
}

/** Day-over-day growth rate comparison (Loc vs Prod). */
export function GrowthRateChart({ days }: { days: PerfDay[] }) {
  const seriesData = useMemo(
    () =>
      days.map((d) => ({
        label: dayLabel(d),
        date: d.date,
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
      animationDuration: 450,
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: theme.dark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.97)',
        borderColor: theme.dark ? '#334155' : '#e2e8f0',
        textStyle: { color: theme.text, fontSize: 12 },
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
        axisLabel: {
          color: theme.muted,
          fontSize: 10,
          formatter: (v: number) => `${v}%`,
        },
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
          connectNulls: false,
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
            lineStyle: { color: theme.axis, type: 'solid', width: 1 },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: 'Product growth',
          type: 'line',
          smooth: 0.25,
          symbol: 'diamond',
          symbolSize: 7,
          connectNulls: false,
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
