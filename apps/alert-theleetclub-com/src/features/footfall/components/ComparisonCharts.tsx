import { useCallback, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { alignedDayRows, normalizeDaysBreakdown } from '@/features/footfall/lib/daysBreakdown';
import { hasDailyPeriodCompare, periodCompareDaySlots } from '@/features/footfall/lib/periodCompareDays';
import type { LocationReport } from '@/features/footfall/lib/types';
import { ChartExportWrap } from '@/features/footfall/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/features/footfall/lib/chartExport';
import { TrendCharts } from '@/features/footfall/components/TrendCharts';

type Props = {
  location: LocationReport;
  benchmarkPct: number;
  showPeriodCompare?: boolean;
};

/** Reference-style: footfall exposure vs conversion % — gap = commercial leakage */
export function DivergenceChart({ location, benchmarkPct }: { location: LocationReport; benchmarkPct: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const hours = location.hours;

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(
      chartInst.current,
      chartFilename([location.locationName, 'divergence']),
    );
  }, [location.locationName]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartInst.current = chart;
    const labels = hours.map((h) => h.label);
    const weakRanges = hours
      .filter((h) => h.isWeakConversion)
      .map((h) => [{ xAxis: h.label }, { xAxis: h.label }]);

    chart.setOption({
      title: {
        text: 'Footfall vs conversion — divergence analysis',
        subtext: 'Shaded hours: high traffic but conversion below benchmark (unrealized potential)',
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600 },
        subtextStyle: { fontSize: 11, color: '#64748b' },
      },
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, data: ['Avg footfall', 'Conversion %', `Benchmark ${benchmarkPct}%`] },
      grid: { left: 58, right: 58, top: 64, bottom: 56 },
      xAxis: { type: 'category', data: labels, boundaryGap: false },
      yAxis: [
        {
          type: 'value',
          name: 'Footfall',
          position: 'left',
          axisLine: { lineStyle: { color: '#5eb8e8' } },
          axisLabel: { color: '#5eb8e8' },
        },
        {
          type: 'value',
          name: 'Conv %',
          position: 'right',
          min: 0,
          max: Math.max(15, benchmarkPct * 2, ...hours.map((h) => h.conversionPct)),
          axisLabel: { formatter: '{value}%', color: '#1e4fd6' },
          axisLine: { lineStyle: { color: '#1e4fd6' } },
        },
      ],
      series: [
        {
          name: 'Avg footfall',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 0 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(94,184,232,0.6)' },
              { offset: 1, color: 'rgba(94,184,232,0.05)' },
            ]),
          },
          itemStyle: { color: '#5eb8e8' },
          data: hours.map((h) => h.footfall),
          markArea: weakRanges.length
            ? {
                silent: true,
                itemStyle: { color: 'rgba(192, 57, 43, 0.18)', borderColor: 'rgba(192,57,43,0.4)', borderWidth: 1 },
                data: weakRanges,
              }
            : undefined,
        },
        {
          name: 'Conversion %',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'rect',
          symbolSize: 7,
          lineStyle: { width: 2.5, color: '#1e4fd6' },
          data: hours.map((h) => h.conversionPct),
        },
        {
          name: `Benchmark ${benchmarkPct}%`,
          type: 'line',
          yAxisIndex: 1,
          symbol: 'none',
          lineStyle: { type: 'dashed', width: 2, color: '#888' },
          data: labels.map(() => benchmarkPct),
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, [location, benchmarkPct, hours]);

  return (
    <ChartExportWrap onExport={exportChart} className="chartExportWrapBlock">
      <div ref={ref} className="chartPanel" />
    </ChartExportWrap>
  );
}

/** Primary period vs compare period (when compare dates enabled) */
export function PeriodCompareChart({ location }: { location: LocationReport }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const cmp = location.compareHours;
  const hasCompare = Boolean(cmp?.length && location.comparePeriodDates?.length);

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(
      chartInst.current,
      chartFilename([location.locationName, 'period-compare-hourly']),
    );
  }, [location.locationName]);

  useEffect(() => {
    if (!ref.current || !hasCompare || !cmp) return;
    const chart = echarts.init(ref.current);
    chartInst.current = chart;
    const labels = location.hours.map((h) => h.label);
    const cmpDates = location.comparePeriodDates ?? [];
    chart.setOption({
      title: {
        text: 'Period comparison — footfall & cups',
        subtext: `Primary ${location.periodDates[0]}–${location.periodDates.at(-1)} vs Compare ${cmpDates[0]}–${cmpDates.at(-1)}`,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600 },
        subtextStyle: { fontSize: 10, color: '#64748b' },
      },
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0 },
      grid: { left: 56, right: 56, top: 72, bottom: 56 },
      xAxis: { type: 'category', data: labels },
      yAxis: [
        { type: 'value', name: 'Footfall', position: 'left' },
        { type: 'value', name: 'Cups', position: 'right' },
      ],
      series: [
        {
          name: 'Footfall (primary)',
          type: 'bar',
          data: location.hours.map((h) => h.footfall),
          itemStyle: { color: 'rgba(94,184,232,0.75)' },
        },
        {
          name: 'Footfall (compare)',
          type: 'bar',
          data: cmp.map((h) => h.footfall),
          itemStyle: { color: 'rgba(94,184,232,0.35)' },
        },
        {
          name: 'Cups (primary)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: location.hours.map((h) => h.cups),
          lineStyle: { color: '#2e9e5a', width: 2 },
        },
        {
          name: 'Cups (compare)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: cmp.map((h) => h.cups),
          lineStyle: { color: '#2e9e5a', type: 'dashed', width: 2 },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, [location, cmp, hasCompare]);

  if (!hasCompare) return null;

  return (
    <div className="chartSection">
      <ChartExportWrap onExport={exportChart} className="chartExportWrapBlock">
        <div ref={ref} className="chartPanel" />
      </ChartExportWrap>
    </div>
  );
}

/** Each business day in the selected period — footfall, cups, revenue */
export function DailyBreakdownChart({ location }: { location: LocationReport }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const bd = normalizeDaysBreakdown(location.daysBreakdown);
  const days = alignedDayRows(location.daysBreakdown);

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(
      chartInst.current,
      chartFilename([location.locationName, 'daily-breakdown']),
    );
  }, [location.locationName]);

  useEffect(() => {
    if (!ref.current || !days.length) return;
    const chart = echarts.init(ref.current);
    chartInst.current = chart;
    chart.setOption({
      title: {
        text: 'Day-by-day comparison (within period)',
        subtext: 'Compare individual business days to spot outliers vs the period average',
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600 },
        subtextStyle: { fontSize: 11, color: '#64748b' },
      },
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0 },
      grid: { left: 56, right: 48, top: 64, bottom: 56 },
      xAxis: { type: 'category', data: days.map((d) => d.date) },
      yAxis: [
        { type: 'value', name: 'Count', position: 'left' },
        { type: 'value', name: 'KD', position: 'right' },
      ],
      series: [
        {
          name: 'Footfall',
          type: 'bar',
          data: days.map((d) => d.footfall),
          itemStyle: { color: '#5eb8e8' },
        },
        {
          name: 'Cups sold',
          type: 'bar',
          data: days.map((d) => d.cups),
          itemStyle: { color: '#2e9e5a' },
        },
        {
          name: 'Revenue (KD)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'diamond',
          data: days.map((d) => d.revenueKd),
          lineStyle: { color: '#e67e22', width: 2 },
        },
        {
          name: 'Conversion %',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          data: days.map((d) => d.conversionPct),
          lineStyle: { color: '#1e4fd6', type: 'dashed' },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, [location, days]);

  if (!days.length && bd.mode === 'split') {
    const sl = bd.salesRows ?? [];
    const ff = bd.footfallRows ?? [];
    if (!sl.length && !ff.length) return null;
    return (
      <div className="chartSection">
        {bd.note ? <p className="hint chartHint">{bd.note}</p> : null}
        <p className="hint chartHint">
          Sales and camera weeks differ — use the daily tables below for each calendar.
        </p>
      </div>
    );
  }

  if (!days.length) return null;

  return (
    <div className="chartSection">
      {bd.mode === 'aligned' && bd.note ? <p className="hint chartHint">{bd.note}</p> : null}
      <ChartExportWrap onExport={exportChart} className="chartExportWrapBlock">
        <div ref={ref} className="chartPanel chartPanelShort" />
      </ChartExportWrap>
    </div>
  );
}

/** Primary week vs compare week — by business day (Sun–Thu), not only hour-by-hour */
export function DailyPeriodCompareChart({ location }: { location: LocationReport }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const slots = periodCompareDaySlots(location);
  const hasCompare = hasDailyPeriodCompare(location);

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(
      chartInst.current,
      chartFilename([location.locationName, 'period-compare-daily']),
    );
  }, [location.locationName]);

  useEffect(() => {
    if (!ref.current || !hasCompare) return;
    const chart = echarts.init(ref.current);
    chartInst.current = chart;
    const primaryDates = location.periodDates;
    const cmpDates = location.comparePeriodDates ?? [];
    chart.setOption({
      title: {
        text: 'Period comparison — day by day',
        subtext: `Primary ${primaryDates[0]}–${primaryDates.at(-1)} vs Compare ${cmpDates[0]}–${cmpDates.at(-1)} (aligned Sun–Thu)`,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600 },
        subtextStyle: { fontSize: 10, color: '#64748b' },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = params as { seriesName: string; value: number; dataIndex: number }[];
          const i = arr[0]?.dataIndex ?? 0;
          const s = slots[i];
          if (!s) return '';
          return [
            `<strong>${s.label}</strong>`,
            s.primaryDate ? `Primary ${s.primaryDate}` : '',
            s.compareDate ? `Compare ${s.compareDate}` : '',
            ...arr.map((p) => `${p.seriesName}: <b>${p.value ?? 0}</b>`),
          ]
            .filter(Boolean)
            .join('<br/>');
        },
      },
      legend: { bottom: 0 },
      grid: { left: 56, right: 48, top: 72, bottom: 56 },
      xAxis: {
        type: 'category',
        data: slots.map((s) => s.label),
      },
      yAxis: [
        { type: 'value', name: 'Count', position: 'left' },
        { type: 'value', name: 'Conv %', position: 'right', axisLabel: { formatter: '{value}%' } },
      ],
      series: [
        {
          name: 'Footfall (primary)',
          type: 'bar',
          data: slots.map((s) => s.primary?.footfall ?? 0),
          itemStyle: { color: 'rgba(94,184,232,0.85)' },
        },
        {
          name: 'Footfall (compare)',
          type: 'bar',
          data: slots.map((s) => s.compare?.footfall ?? 0),
          itemStyle: { color: 'rgba(94,184,232,0.35)' },
        },
        {
          name: 'Cups (primary)',
          type: 'line',
          smooth: true,
          data: slots.map((s) => s.primary?.cups ?? 0),
          lineStyle: { color: '#2e9e5a', width: 2 },
        },
        {
          name: 'Cups (compare)',
          type: 'line',
          smooth: true,
          data: slots.map((s) => s.compare?.cups ?? 0),
          lineStyle: { color: '#2e9e5a', type: 'dashed', width: 2 },
        },
        {
          name: 'Conv % (primary)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: slots.map((s) => s.primary?.conversionPct ?? 0),
          lineStyle: { color: '#1e4fd6', width: 2 },
        },
        {
          name: 'Conv % (compare)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: slots.map((s) => s.compare?.conversionPct ?? 0),
          lineStyle: { color: '#1e4fd6', type: 'dashed', width: 2 },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, [location, slots, hasCompare]);

  if (!hasCompare) return null;

  return (
    <div className="chartSection">
      <ChartExportWrap onExport={exportChart} className="chartExportWrapBlock">
        <div ref={ref} className="chartPanel chartPanelShort" />
      </ChartExportWrap>
    </div>
  );
}

export function ComparisonCharts({ location, benchmarkPct }: Props) {
  return (
    <section className="comparisonCharts">
      <h3 className="sectionTitle">Charts</h3>
      <DivergenceChart location={location} benchmarkPct={benchmarkPct} />
      <TrendCharts location={location} />
      <DailyBreakdownChart location={location} />
    </section>
  );
}
