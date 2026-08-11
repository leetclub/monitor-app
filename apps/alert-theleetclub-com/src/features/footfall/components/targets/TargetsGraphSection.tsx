import { useCallback, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { LocationReport } from '@/features/footfall/lib/types';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import { ChartExportWrap } from '@/features/footfall/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/features/footfall/lib/chartExport';
import { footfallSeriesLabel, isMirroredFootfall } from '@/features/footfall/lib/footfallLabel';
import {
  hourConversionPct,
  targetCupsForFootfall,
  targetsBenchmarkForLocation,
} from '@/features/footfall/lib/targetsBenchmark';

type Props = {
  location: LocationReport;
};

/** Single chart: footfall, conversion %, benchmark, revenue, gap to target. */
export function TargetsGraphSection({ location }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const hours = location.hours;
  const bench = targetsBenchmarkForLocation(location);
  const pricePerCup =
    location.daily.totalCups > 0
      ? location.daily.totalRevenueKd / location.daily.totalCups
      : 0;

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(
      chartInst.current,
      chartFilename([location.locationName, 'targets-overview']),
    );
  }, [location.locationName]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartInst.current = chart;

    const labels = hours.map((h) => h.label);
    const footfall = hours.map((h) => h.footfall);
    const conversion = hours.map((h) => hourConversionPct(h));
    const revenues = hours.map((h) => Number((h.revenueKd ?? 0).toFixed(3)));
    const remaining = hours.map((h) => {
      const target = targetCupsForFootfall(h.footfall, bench);
      const sold = h.cupsCashless ?? h.cups;
      const gapCups = Math.max(0, target - sold);
      return Number((gapCups * pricePerCup).toFixed(3));
    });

    const maxFootfall = Math.max(1, ...footfall);
    const maxKd = Math.max(
      0.01,
      ...revenues.map((r, i) => r + remaining[i]!),
    );
    const maxConv = Math.max(
      bench * 1.5,
      12,
      ...conversion.filter((v) => Number.isFinite(v)),
    );

    const weakRanges = hours
      .filter((h) => h.footfall > 0 && hourConversionPct(h) < bench * 0.85)
      .map((h) => [{ xAxis: h.label }, { xAxis: h.label }]);

    const ffLabel = footfallSeriesLabel(location);
    const estNote = isMirroredFootfall(location) ? ` · ${ffLabel.toLowerCase()}` : '';

    chart.setOption({
      title: {
        text: `${ffLabel}, conversion, revenue & gap to target`,
        subtext: `${bench}% benchmark (${inferOwnerSegment(location)}) · one view${estNote}`,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600 },
        subtextStyle: { fontSize: 11, color: '#64748b' },
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number }[];
          const idx = arr[0]?.dataIndex ?? 0;
          const h = hours[idx];
          if (!h) return '';
          const sold = h.cupsCashless ?? h.cups;
          const target = targetCupsForFootfall(h.footfall, bench);
          const gapCups = Math.max(0, target - sold);
          const conv = hourConversionPct(h).toFixed(1);
          return [
            `<strong>${h.label}</strong>`,
            `${ffLabel}: ${Math.round(h.footfall).toLocaleString()}`,
            `Conversion: ${conv}% (target ${bench}%)`,
            `Revenue: ${(h.revenueKd ?? 0).toFixed(2)} KD`,
            `Remaining to target: ${(gapCups * pricePerCup).toFixed(2)} KD`,
          ].join('<br/>');
        },
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        data: [
          ffLabel,
          'Conversion %',
          `Target ${bench}%`,
          'Revenues',
          'Remaining to target',
        ],
      },
      grid: { left: 58, right: 108, top: 72, bottom: 56 },
      xAxis: { type: 'category', data: labels, boundaryGap: true },
      yAxis: [
        {
          type: 'value',
          name: ffLabel,
          position: 'left',
          min: 0,
          max: Math.ceil(maxFootfall * 1.12),
          axisLine: { lineStyle: { color: '#5eb8e8' } },
          axisLabel: { color: '#5eb8e8' },
        },
        {
          type: 'value',
          name: 'Conv %',
          position: 'right',
          min: 0,
          max: Math.ceil(maxConv * 1.08),
          axisLabel: { formatter: '{value}%', color: '#1e4fd6' },
          axisLine: { lineStyle: { color: '#1e4fd6' } },
        },
        {
          type: 'value',
          name: 'KD',
          position: 'right',
          offset: 52,
          min: 0,
          max: Math.ceil(maxKd * 1.25 * 10) / 10,
          axisLabel: {
            color: '#0d9488',
            formatter: (v: number) => `${v.toFixed(1)}`,
          },
          axisLine: { lineStyle: { color: '#0d9488' } },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: ffLabel,
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 0 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(94,184,232,0.55)' },
              { offset: 1, color: 'rgba(94,184,232,0.05)' },
            ]),
          },
          itemStyle: { color: '#5eb8e8' },
          data: footfall,
          markArea: weakRanges.length
            ? {
                silent: true,
                itemStyle: {
                  color: 'rgba(192, 57, 43, 0.14)',
                  borderColor: 'rgba(192,57,43,0.35)',
                  borderWidth: 1,
                },
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
          symbolSize: 6,
          lineStyle: { width: 2.5, color: '#1e4fd6' },
          data: conversion,
        },
        {
          name: `Target ${bench}%`,
          type: 'line',
          yAxisIndex: 1,
          symbol: 'none',
          lineStyle: { type: 'dashed', width: 2, color: '#94a3b8' },
          data: labels.map(() => bench),
        },
        {
          name: 'Revenues',
          type: 'bar',
          yAxisIndex: 2,
          barWidth: labels.length > 14 ? '28%' : '34%',
          itemStyle: { color: '#0d9488' },
          data: revenues,
        },
        {
          name: 'Remaining to target',
          type: 'bar',
          yAxisIndex: 2,
          barGap: '-100%',
          barWidth: labels.length > 14 ? '28%' : '34%',
          itemStyle: { color: 'rgba(220, 38, 38, 0.55)' },
          data: remaining,
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
  }, [location, hours, bench, pricePerCup]);

  return (
    <div className="targetsGraphSection">
      <h3 className="sectionTitle">Hourly overview · {location.locationName}</h3>
      <ChartExportWrap onExport={exportChart} className="chartExportWrapBlock">
        <div ref={ref} className="chartPanel" />
      </ChartExportWrap>
    </div>
  );
}
