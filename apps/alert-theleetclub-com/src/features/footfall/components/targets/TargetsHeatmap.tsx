import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { HourRow, LocationReport } from '@/features/footfall/lib/types';
import { displayFootfallTotal } from '@/features/footfall/lib/footfallMetrics';
import { ChartExportWrap } from '@/features/footfall/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/features/footfall/lib/chartExport';
import {
  hourConversionPct,
  targetsBenchmarkForLocation,
} from '@/features/footfall/lib/targetsBenchmark';
import { footfallCupsColonRatio } from '@/features/footfall/lib/ratioLabel';

type HeatMetric = 'cups' | 'ratio' | 'conversion';

const METRICS: { id: HeatMetric; label: string; explain: string }[] = [
  { id: 'cups', label: 'Cups', explain: 'Average cashless cups in this hour (5-day profile).' },
  {
    id: 'ratio',
    label: 'Ratio',
    explain: 'Footfall : cups (e.g. 4:2). Higher first number = more visitors per cup sold.',
  },
  {
    id: 'conversion',
    label: 'Conversion',
    explain:
      'Conversion % = cashless cups ÷ footfall × 100. Cell numbers omit “%”; segment benchmark (O2 6.2%, MOH 20%, KU 35%) is in the hour popup.',
  },
];

function cellValue(metric: HeatMetric, h: HourRow): number {
  const cashless = h.cupsCashless ?? h.cups;
  if (metric === 'cups') return cashless;
  if (metric === 'conversion') {
    return h.footfall > 0 ? (cashless / h.footfall) * 100 : h.conversionPct;
  }
  if (h.footfall > 0 && cashless > 0) return h.footfall / cashless;
  return 0;
}

function cellLabel(metric: HeatMetric, v: number, h?: HourRow): string {
  if (metric === 'ratio' && h) return footfallCupsColonRatio(h);
  if (!v || !Number.isFinite(v)) return '';
  if (metric === 'conversion') return `${Math.round(v)}`;
  const n = Math.round(v);
  return Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

type Props = {
  locations: LocationReport[];
  onSelect: (machineId: string) => void;
};

export function TargetsHeatmap({ locations, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const [metric, setMetric] = useState<HeatMetric>('cups');
  const [popup, setPopup] = useState<{
    loc: LocationReport;
    h: HourRow;
    label: string;
  } | null>(null);

  const top = useMemo(
    () =>
      [...locations]
        .sort(
          (a, b) =>
            b.daily.totalCups - a.daily.totalCups ||
            displayFootfallTotal(b) - displayFootfallTotal(a) ||
            a.locationName.localeCompare(b.locationName),
        )
        .slice(0, 16),
    [locations],
  );

  const metricMeta = METRICS.find((m) => m.id === metric)!;

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(chartInst.current, chartFilename(['targets-heatmap', metric]));
  }, [metric]);

  useEffect(() => {
    if (!ref.current || !top.length) return;
    const hours = top[0].hours.map((h) => h.label);
    const data: [number, number, number][] = [];
    top.forEach((loc, yi) => {
      loc.hours.forEach((h, xi) => {
        data.push([xi, yi, cellValue(metric, h)]);
      });
    });

    const chart = echarts.init(ref.current);
    chartInst.current = chart;
    const maxVal = Math.max(1, ...data.map((d) => d[2]));
    const convMax =
      metric === 'conversion'
        ? Math.max(25, ...top.map((l) => targetsBenchmarkForLocation(l) * 1.5), maxVal)
        : maxVal;

    chart.setOption({
      title: {
        text: `Heatmap — ${metricMeta.label}`,
        subtext: `${metricMeta.explain} · Cell labels omit % · click for detail`,
        left: 'center',
        textStyle: { fontSize: 13, fontWeight: 600 },
        subtextStyle: { fontSize: 10, color: '#64748b' },
      },
      tooltip: { show: false },
      grid: { left: 140, right: 28, top: 80, bottom: 56 },
      xAxis: { type: 'category', data: hours, splitArea: { show: true } },
      yAxis: {
        type: 'category',
        data: top.map((l) => l.locationName),
        axisLabel: { width: 130, overflow: 'truncate', fontSize: 10 },
      },
      visualMap: {
        min: 0,
        max: metric === 'conversion' || metric === 'ratio' ? convMax : maxVal,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: {
          color:
            metric === 'cups'
              ? ['#fff9e6', '#fde68a', '#a3e635', '#4d7c0f']
              : ['#c0392b', '#e67e22', '#f9e79f', '#aed581', '#2e9e5a'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: {
            show: true,
            formatter: (p: { data: [number, number, number] }) => {
              const [xi, yi, v] = p.data;
              const h = top[yi]?.hours[xi];
              return cellLabel(metric, v, h);
            },
            fontSize: 9,
          },
        },
      ],
    });

    chart.off('click');
    chart.on('click', (raw) => {
      const params = raw as { componentType?: string; data?: unknown };
      if (params.componentType !== 'series' || !Array.isArray(params.data)) return;
      const [xi, yi] = params.data as [number, number, number];
      const loc = top[yi];
      const h = loc?.hours[xi];
      if (!loc || !h) return;
      setPopup({ loc, h, label: hours[xi] ?? h.label });
      onSelect(loc.machineId);
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, [top, metric, metricMeta, onSelect]);

  const popupBench = popup ? targetsBenchmarkForLocation(popup.loc) : 0;
  const popupConv = popup ? hourConversionPct(popup.h) : 0;
  const popupCashless = popup ? popup.h.cupsCashless ?? popup.h.cups : 0;

  return (
    <div className="targetsHeatmapBlock">
      <div className="heatmapMetricTabs">
        {METRICS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={metric === m.id ? 'heatmapMetricTab active' : 'heatmapMetricTab'}
            onClick={() => setMetric(m.id)}
            title={m.explain}
          >
            {m.label}
          </button>
        ))}
      </div>
      <ChartExportWrap onExport={exportChart}>
        <div ref={ref} className="chartBox targetsHeatmapChart" />
      </ChartExportWrap>
      {popup ? (
        <div className="targetsCellPopup" role="dialog" aria-label="Hour detail">
          <button type="button" className="targetsPopupClose" onClick={() => setPopup(null)}>
            ×
          </button>
          <strong>{popup.loc.locationName}</strong>
          <span className="targetsPopupHour">{popup.label}</span>
          <div className="targetsPopupGrid">
            <div>
              <span className="kpiLabel">Cups</span>
              <div className="kpiValue">{Math.round(popupCashless)}</div>
            </div>
            <div>
              <span className="kpiLabel">Ratio (footfall:cups)</span>
              <div className="kpiValue">{footfallCupsColonRatio(popup.h) || popup.h.conversionRatio}</div>
            </div>
            <div>
              <span className="kpiLabel">Conversion %</span>
              <div className="kpiValue">{popupConv.toFixed(1)}%</div>
            </div>
          </div>
          <p className="kpiHint">
            Benchmark {popupBench}% for this segment · avg hourly profile.{' '}
            {popupConv >= popupBench
              ? 'At or above benchmark this hour.'
              : `Below benchmark by ${(popupBench - popupConv).toFixed(1)} pts.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
