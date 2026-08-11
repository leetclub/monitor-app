import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import type { LocationReport } from '@/features/footfall/lib/types';
import { ChartExportWrap } from '@/features/footfall/components/ChartExportWrap';
import { useNightChart } from '@/features/footfall/NightChartContext';
import { chartFilename, downloadChartPng } from '@/features/footfall/lib/chartExport';
import { hourlyChartTheme } from '@/features/footfall/lib/chartNightTheme';
import { formatCups } from '@/features/footfall/lib/formatCups';
import { HOURLY_REVENUE_REFERENCE_KD, hourlyCaptureSummary } from '@/features/footfall/lib/hourlyCaptureSummary';
import { gapHourMarkAreas, weakConversionMarkAreas } from '@/features/footfall/lib/hourlyChartGapVisuals';
import {
  gapBarLabelStyle,
  hourGapLabel,
  hourSoldLabel,
  soldBarLabelStyle,
} from '@/features/footfall/lib/hourlyChartLabels';
import { footfallSeriesLabel, footfallSourceShort } from '@/features/footfall/lib/footfallLabel';
import { isProxySales, salesMetricColor } from '@/features/footfall/lib/salesDisplay';

type Props = {
  location: LocationReport;
  benchmarkPct: number;
};

function hourLabelInterval(hourCount: number): number | 'auto' {
  if (hourCount <= 12) return 0;
  if (hourCount <= 18) return 1;
  return 2;
}

export function HourlyChart({ location, benchmarkPct }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const nightMode = useNightChart();
  const hours = location.hours;
  const summary = useMemo(() => hourlyCaptureSummary(hours), [hours]);
  const proxy = isProxySales(location);
  const hasGap = summary.totalMissedCups > 0;
  const ffLabel = footfallSeriesLabel(location);

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(
      chartInst.current,
      chartFilename([location.locationName, 'hourly-footfall-sales']),
    );
  }, [location.locationName]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chartInst.current = chart;
    const soldColorDay = salesMetricColor(location);
    const t = hourlyChartTheme(nightMode);
    const soldColor = nightMode ? (proxy ? '#ffb347' : t.soldBar) : soldColorDay;
    const cupsSeriesName = proxy ? 'Cups sold (proxy)' : 'Cups sold';
    const targetName = `Could achieve @ ${benchmarkPct}%`;
    const labels = hours.map((h) => h.label);
    const labelStep = hourLabelInterval(labels.length);
    const weakRanges = weakConversionMarkAreas(hours);
    const gapRanges = gapHourMarkAreas(hours);

    const maxFootfall = Math.max(1, ...hours.map((h) => h.footfall));
    const maxCups = Math.max(
      1,
      ...hours.map((h) => Math.max(h.aspiredCups, h.cups + h.upliftCups)),
    );

    const ffKind = footfallSourceShort(location);

    const subtext = nightMode
      ? `Cyan = ${ffLabel.toLowerCase()} (${ffKind}) · Lime = sold · Orange band = target · Magenta +N = missed`
      : `Blue = ${ffLabel.toLowerCase()} (${ffKind}) · Green = sold · Pale orange = full target · Red +N = missed cups · Stripes = weak hours`;

    chart.setOption(
      {
        backgroundColor: t.chartBg,
        title: {
          text: `${ffLabel} vs capture — gap at a glance`,
          subtext,
          left: 'center',
          textStyle: {
            fontSize: 15,
            fontWeight: 700,
            color: t.titleColor,
            ...(nightMode ? { textShadowColor: 'rgba(0,229,255,0.45)', textShadowBlur: 12 } : {}),
          },
          subtextStyle: { fontSize: 11, color: t.axisMuted, lineHeight: 16 },
        },
        tooltip: {
          trigger: 'axis',
          confine: true,
          backgroundColor: t.tooltipBg,
          borderColor: t.tooltipBorder,
          textStyle: { fontSize: 12, color: t.tooltipText },
          formatter: (params: unknown) => {
            const arr = params as { dataIndex: number }[];
            const idx = arr[0]?.dataIndex ?? 0;
            const h = hours[idx];
            if (!h) return '';
            const mirror = h.footfallMirror
              ? `<br/><span style="color:${h.footfallMirror.color}">Mirrored: ${h.footfallMirror.value}</span>`
              : '';
            const gap =
              h.upliftCups > 0
                ? `<span style="color:${t.gapBadgeBg};font-weight:700">Shortfall: +${formatCups(h.upliftCups)} cups (+${h.upliftKd.toFixed(2)} KD)</span>`
                : `<span style="color:${t.okText}">Captured full target this hour</span>`;
            const revPct =
              HOURLY_REVENUE_REFERENCE_KD > 0
                ? ((h.revenueKd / HOURLY_REVENUE_REFERENCE_KD) * 100).toFixed(1)
                : '0';
            return [
              `<strong>${h.label}</strong>`,
              `${ffLabel}: ${Math.round(h.footfall).toLocaleString()}${mirror}`,
              `Target @ ${benchmarkPct}%: ${formatCups(h.aspiredCups)} cups`,
              `Cups sold: ${formatCups(h.cups)}`,
              gap,
              `Revenue: ${h.revenueKd.toFixed(2)} KD (${revPct}% of ${HOURLY_REVENUE_REFERENCE_KD} KD ref)`,
              `Conversion: ${(
                h.footfall > 0
                  ? (((h.cupsCashless ?? h.cups) / h.footfall) * 100).toFixed(1)
                  : h.conversionPct
              )}% (${h.conversionRatio})`,
              h.isWeakConversion
                ? `<span style="color:${t.gapBadgeBg}">Weak hour — high traffic, below benchmark</span>`
                : '',
            ]
              .filter(Boolean)
              .join('<br/>');
          },
        },
        legend: {
          type: 'scroll',
          bottom: 4,
          left: 'center',
          selectedMode: true,
          itemGap: 12,
          textStyle: { fontSize: 11, color: t.legendText },
          data: [ffLabel, targetName, cupsSeriesName, 'Revenue (KD)'],
          selected: { 'Revenue (KD)': false },
        },
        grid: { left: 64, right: 72, top: 88, bottom: nightMode ? 92 : 86 },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: true,
          axisLine: { lineStyle: { color: nightMode ? 'rgba(136,153,170,0.35)' : '#ccc' } },
          axisLabel: {
            interval: labelStep,
            rotate: labels.length > 14 ? 50 : labels.length > 10 ? 35 : 0,
            fontSize: 10,
            hideOverlap: true,
            margin: 14,
            color: t.axisMuted,
          },
          axisTick: { alignWithLabel: true },
        },
        yAxis: [
          {
            type: 'value',
            name: ffLabel,
            position: 'left',
            min: 0,
            max: Math.ceil(maxFootfall * 1.12),
            axisLine: {
              show: true,
              lineStyle: {
                color: t.footfallAxis,
                width: 2.5,
                shadowColor: nightMode ? t.footfallGlow : undefined,
                shadowBlur: nightMode ? 8 : 0,
              },
            },
            axisLabel: { color: t.footfallAxis, fontSize: 10, fontWeight: 600, hideOverlap: true },
            nameTextStyle: { color: t.footfallAxis, fontWeight: 700, fontSize: 11 },
            splitLine: { lineStyle: { color: t.footfallGrid } },
          },
          {
            type: 'value',
            name: 'Cups',
            position: 'right',
            min: 0,
            max: Math.ceil(maxCups * 1.45),
            axisLine: { show: true, lineStyle: { color: t.cupsAxis, width: 2 } },
            axisLabel: {
              color: t.cupsAxis,
              fontSize: 10,
              hideOverlap: true,
              formatter: (v: number) => formatCups(v),
            },
            nameTextStyle: { color: t.cupsAxis, fontWeight: 700, fontSize: 11 },
            splitLine: { show: false },
          },
          {
            type: 'value',
            name: 'KD',
            position: 'right',
            offset: 54,
            min: 0,
            max: HOURLY_REVENUE_REFERENCE_KD,
            show: false,
          },
        ],
        series: [
          {
            name: ffLabel,
            type: 'line',
            yAxisIndex: 0,
            z: 1,
            smooth: 0.35,
            symbol: 'circle',
            symbolSize: (val: number) => (val > maxFootfall * 0.55 ? 7 : 4),
            showSymbol: labels.length <= 20,
            lineStyle: {
              width: nightMode ? 3.5 : 3,
              color: t.footfallLine,
              shadowColor: nightMode ? 'rgba(0,229,255,0.65)' : undefined,
              shadowBlur: nightMode ? 14 : 0,
            },
            itemStyle: {
              color: t.footfallLine,
              shadowColor: nightMode ? 'rgba(0,229,255,0.8)' : undefined,
              shadowBlur: nightMode ? 10 : 0,
            },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: t.footfallAreaTop },
                { offset: 1, color: t.footfallAreaBottom },
              ]),
            },
            data: hours.map((h) => h.footfall),
            markArea: weakRanges.length
              ? {
                  silent: true,
                  itemStyle: {
                    color: t.weakBand,
                    borderColor: t.weakBandBorder,
                    borderWidth: 1,
                  },
                  label: {
                    show: true,
                    position: 'insideTop',
                    color: t.weakLabel,
                    fontSize: 10,
                    fontWeight: 700,
                    formatter: 'Gap',
                  },
                  data: weakRanges,
                }
              : undefined,
          },
          {
            name: targetName,
            type: 'bar',
            yAxisIndex: 1,
            z: 2,
            barWidth: labels.length > 14 ? '36%' : '46%',
            itemStyle: {
              color: t.targetFill,
              borderColor: t.targetBorder,
              borderWidth: 1.5,
              borderType: 'dashed',
              ...(nightMode
                ? {
                    shadowColor: 'rgba(255,159,67,0.35)',
                    shadowBlur: 8,
                  }
                : {}),
            },
            data: hours.map((h) => h.aspiredCups),
            markArea: gapRanges.length
              ? { silent: true, itemStyle: { color: t.gapBand }, data: gapRanges }
              : undefined,
            label: {
              ...gapBarLabelStyle(nightMode),
              formatter: hourGapLabel(hours),
            },
          },
          {
            name: cupsSeriesName,
            type: 'bar',
            yAxisIndex: 1,
            z: 4,
            barGap: '-100%',
            barWidth: labels.length > 14 ? '36%' : '46%',
            itemStyle: {
              color: nightMode
                ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: soldColor },
                    { offset: 1, color: proxy ? '#cc8800' : '#00c853' },
                  ])
                : soldColor,
              borderRadius: [3, 3, 0, 0],
              ...(nightMode
                ? {
                    shadowColor: 'rgba(57,255,20,0.55)',
                    shadowBlur: 12,
                  }
                : {}),
            },
            data: hours.map((h) => h.cups),
            label: {
              ...soldBarLabelStyle(nightMode),
              formatter: hourSoldLabel(hours),
            },
          },
          {
            name: 'Revenue (KD)',
            type: 'line',
            yAxisIndex: 2,
            z: 2,
            symbol: 'circle',
            symbolSize: 4,
            showSymbol: labels.length <= 14,
            lineStyle: { width: 1.5, color: t.revenueLine, type: 'dotted' },
            itemStyle: { color: t.revenueItem },
            data: hours.map((h) => h.revenueKd),
          },
        ],
      },
      true,
    );

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, [location, benchmarkPct, hours, proxy, nightMode]);

  return (
    <div className={`hourlyChartBlock ${nightMode ? 'hourlyChartBlockNight' : ''}`}>
      {hasGap ? (
        <div className="hourlyGapBanner" role="status">
          <span className="hourlyGapBannerLead">Captured {summary.capturePct}% of target</span>
          <span className="hourlyGapBannerStats">
            <strong className="hourlyGapEmphasis">
              +{formatCups(summary.totalMissedCups)} cups
            </strong>{' '}
            (+{summary.totalMissedKd.toFixed(1)} KD) missed
          </span>
        </div>
      ) : (
        <div className="hourlyGapBanner hourlyGapBannerOk" role="status">
          Full target captured.
        </div>
      )}
      <ChartExportWrap onExport={exportChart}>
        <div ref={ref} className={`hourlyChart chartPanel ${nightMode ? 'chartPanelNight' : ''}`} />
      </ChartExportWrap>

      <div className="hourlyCaptureSummary" role="group" aria-label="Period capture summary">
        <div className="hourlyCaptureCard hourlyCaptureCardFootfall">
          <span className="hourlyCaptureLabel">
            <span className="termKey">{ffLabel}</span> (period)
          </span>
          <span className="hourlyCaptureValue">{Math.round(summary.totalFootfall).toLocaleString()}</span>
          <span className="hourlyCaptureHint">Blue area — {ffLabel.toLowerCase()}</span>
        </div>
        <div className="hourlyCaptureCard hourlyCaptureCardSold">
          <span className="hourlyCaptureLabel">Cups sold</span>
          <span className="hourlyCaptureValue">{formatCups(summary.totalCups)}</span>
          <span className="hourlyCaptureHint">{proxy ? 'Proxy sales week' : 'Green bars'}</span>
        </div>
        <div className="hourlyCaptureCard hourlyCaptureCardTarget">
          <span className="hourlyCaptureLabel">
            <span className="termKey">Could achieve</span> @ {benchmarkPct}%
          </span>
          <span className="hourlyCaptureValue">{formatCups(summary.totalAspired)}</span>
          <span className="hourlyCaptureHint">Orange target band · {summary.capturePct}% captured</span>
        </div>
        <div className="hourlyCaptureCard hourlyCaptureCardRevenue">
          <span className="hourlyCaptureLabel">Revenue (period)</span>
          <span className="hourlyCaptureValue">{summary.totalRevenueKd.toFixed(1)} KD</span>
          <span className="hourlyCaptureHint">
            {summary.revenuePctOfReference}% of {HOURLY_REVENUE_REFERENCE_KD} KD ref
          </span>
        </div>
        <div
          className={`hourlyCaptureCard hourlyCaptureCardMissed ${hasGap ? 'hourlyCaptureCardWarn' : ''}`}
        >
          <span className="hourlyCaptureLabel">
            <span className="termKey">Missed potential</span> (cups)
          </span>
          <span className="hourlyCaptureValue">
            {hasGap ? `+${formatCups(summary.totalMissedCups)}` : '0'}
          </span>
          <span className="hourlyCaptureHint">
            {hasGap
              ? `Red +N on chart · +${summary.totalMissedKd.toFixed(1)} KD${summary.weakHourCount > 0 ? ` · ${summary.weakHourCount} weak hour(s)` : ''}`
              : 'No shortfall vs target'}
          </span>
        </div>
      </div>
    </div>
  );
}