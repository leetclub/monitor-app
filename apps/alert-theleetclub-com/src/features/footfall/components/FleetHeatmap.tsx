import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { LocationReport, ReportPayload } from '@/features/footfall/lib/types';
import { ChartExportWrap } from '@/features/footfall/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/features/footfall/lib/chartExport';
import {
  defaultFleetHeatmapMetric,
  FLEET_HEATMAP_METRICS,
  fleetHasNetHourly,
  fleetHasShortfallHourly,
  formatHeatmapCellLabel,
  heatmapSubtext,
  heatmapTitle,
  heatmapTooltipHtml,
  hourMetricValue,
  visualMapForMetric,
  type FleetHeatmapMetric,
} from '@/features/footfall/lib/fleetHeatmapMetrics';

type Props = {
  report: ReportPayload;
  locations: LocationReport[];
  onSelect: (machineId: string) => void;
};

const TOP_N = 14;

function pickFleetRows(locations: LocationReport[]): LocationReport[] {
  return [...locations]
    .filter(
      (l) =>
        (l.daily.projectedFootfall ?? l.daily.totalFootfall) > 0 || l.daily.totalCups > 0,
    )
    .sort((a, b) => b.daily.totalCups - a.daily.totalCups)
    .slice(0, TOP_N);
}

/** Fleet-wide hourly heatmap — red heat for gap & exposure; green where capture is good. */
export function FleetHeatmap({ report, locations, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  const salesWeekOnly = locations.some((l) => l.daily.periodsAligned === false);
  const hasNet = fleetHasNetHourly(locations);
  const hasShortfall = fleetHasShortfallHourly(locations);

  const [metric, setMetric] = useState<FleetHeatmapMetric>(() =>
    defaultFleetHeatmapMetric(salesWeekOnly, locations),
  );

  const visibleMetrics = useMemo(
    () =>
      FLEET_HEATMAP_METRICS.filter((m) => {
        if (m.id === 'net' && !hasNet) return false;
        if (m.id === 'shortfall' && !hasShortfall) return false;
        return true;
      }),
    [hasNet, hasShortfall],
  );

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    const period = report.primaryPeriod;
    downloadChartPng(
      chartInst.current,
      chartFilename(['fleet-heatmap', metric, period?.[0], period?.at(-1)]),
    );
  }, [report.primaryPeriod, metric]);

  useEffect(() => {
    if (!visibleMetrics.some((m) => m.id === metric)) {
      setMetric(defaultFleetHeatmapMetric(salesWeekOnly, locations));
    }
  }, [visibleMetrics, metric, salesWeekOnly, locations]);

  useEffect(() => {
    if (!ref.current) return;
    const top = pickFleetRows(locations);
    if (!top.length) return;

    const hours = top[0].hours.map((h) => h.label);

    const data: [number, number, number][] = [];
    top.forEach((loc, yi) => {
      loc.hours.forEach((h, xi) => {
        data.push([xi, yi, hourMetricValue(metric, h, loc)]);
      });
    });

    const chart = echarts.init(ref.current);
    chartInst.current = chart;

    const seriesName = FLEET_HEATMAP_METRICS.find((m) => m.id === metric)?.label ?? metric;

    chart.setOption(
      {
        title: {
          text: heatmapTitle(metric, salesWeekOnly),
          subtext: heatmapSubtext(metric, salesWeekOnly),
          left: 'center',
          textStyle: { fontSize: 13, fontWeight: 600 },
          subtextStyle: { fontSize: 10, color: '#64748b' },
        },
        tooltip: {
          position: 'top',
          formatter: (p: unknown) => {
            const pt = p as { data: [number, number, number] };
            const [xi, yi] = pt.data;
            const loc = top[yi];
            const h = loc?.hours[xi];
            if (!loc || !h) return '';
            return heatmapTooltipHtml(loc, h, hours[xi] ?? h.label, metric);
          },
        },
        grid: { left: 140, right: 28, top: 72, bottom: 56 },
        xAxis: { type: 'category', data: hours, splitArea: { show: true } },
        yAxis: {
          type: 'category',
          data: top.map((l) => l.locationName),
          axisLabel: { width: 130, overflow: 'truncate', fontSize: 10 },
        },
        visualMap: visualMapForMetric(metric, data, report.benchmarkConversionPct),
        series: [
          {
            name: seriesName,
            type: 'heatmap',
            data,
            label: {
              show: true,
              fontSize: 9,
              color: '#0f2942',
              formatter: (params: unknown) => {
                const row = params as { data: [number, number, number] };
                const [xi, yi] = row.data;
                const h = top[yi]?.hours[xi];
                return formatHeatmapCellLabel(metric, row.data[2], h);
              },
            },
            emphasis: {
              itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.2)' },
              label: { fontSize: 10, fontWeight: 'bold' },
            },
          },
        ],
      },
      true,
    );

    chart.off('click');
    chart.on('click', (params) => {
      const raw = params.data;
      if (params.componentType === 'series' && Array.isArray(raw) && raw.length >= 2) {
        const yi = Number(raw[1]);
        const loc = top[yi];
        if (loc) onSelect(loc.machineId);
      }
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInst.current = null;
    };
  }, [report, locations, onSelect, salesWeekOnly, metric]);

  const hasData = locations.some(
    (l) => (l.daily.projectedFootfall ?? l.daily.totalFootfall) > 0 || l.daily.totalCups > 0,
  );

  if (!hasData) {
    return (
      <section className="fleetHeatmapSection">
        <p className="hint">No fleet data for this date range.</p>
      </section>
    );
  }

  return (
    <section className="fleetHeatmapSection">
      <div className="fleetHeatmapHeader">
        <div className="fleetHeatmapMetricBar" role="tablist" aria-label="Heatmap metric">
          {visibleMetrics.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              className={
                metric === m.id
                  ? `fleetHeatmapMetric active${m.id === 'shortfall' || m.id === 'footfall' ? ' fleetHeatmapMetricHeat' : ''}`
                  : `fleetHeatmapMetric${m.id === 'shortfall' || m.id === 'footfall' ? ' fleetHeatmapMetricHeat' : ''}`
              }
              onClick={() => setMetric(m.id)}
            >
              {m.short}
            </button>
          ))}
        </div>
      </div>
      <ChartExportWrap onExport={exportChart} className="chartExportWrapBlock">
        <div ref={ref} className="chartPanel chartPanelHeatmap chartPanelHeatmapTall" />
      </ChartExportWrap>
    </section>
  );
}
