import { useCallback, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { LocationReport } from '@/features/footfall/lib/types';
import { ChartExportWrap } from '@/features/footfall/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/features/footfall/lib/chartExport';
import {
  formatNetPeriodLine,
  NET_TRAFFIC_LABEL,
  NET_TRAFFIC_LEAD,
  NET_TRAFFIC_SECTION_TITLE,
} from '@/features/footfall/lib/netTrafficCopy';

type Props = { location: LocationReport };

export function hasHourlyNetTraffic(location: LocationReport): boolean {
  return (location.hours ?? []).some(
    (h) => (h.peopleIn ?? 0) > 0 || (h.peopleOut ?? 0) > 0 || (h.netTraffic ?? 0) !== 0,
  );
}

export function hasPeriodNetTraffic(location: LocationReport): boolean {
  const d = location.daily;
  return (d.totalIn ?? 0) > 0 && d.totalNet != null;
}

export function NetTrafficChart({ location }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const hours = location.hours ?? [];
  const hasHourly = hasHourlyNetTraffic(location);
  const d = location.daily;
  const hasPeriod = hasPeriodNetTraffic(location);

  const exportChart = useCallback(() => {
    if (!chartInst.current) return;
    downloadChartPng(chartInst.current, chartFilename([location.locationName, 'net-traffic']));
  }, [location.locationName]);

  useEffect(() => {
    if (!ref.current || !hasHourly) return;
    const chart = echarts.init(ref.current);
    chartInst.current = chart;
    const labels = hours.map((h) => h.label);
    const periodLine =
      hasPeriod && d.totalIn != null && d.totalOut != null && d.totalNet != null
        ? formatNetPeriodLine(d.totalIn, d.totalOut, d.totalNet)
        : 'Avg per business hour';
    chart.setOption({
      title: {
        text: 'Net traffic by hour',
        subtext: periodLine,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 600 },
        subtextStyle: { fontSize: 11, color: '#64748b' },
      },
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, data: ['In', 'Out', NET_TRAFFIC_LABEL] },
      grid: { left: 56, right: 24, top: 72, bottom: 56 },
      xAxis: { type: 'category', data: labels },
      yAxis: { type: 'value', name: 'Count' },
      series: [
        {
          name: 'In',
          type: 'bar',
          stack: 'traffic',
          itemStyle: { color: 'rgba(46, 158, 90, 0.75)' },
          data: hours.map((h) => h.peopleIn ?? 0),
        },
        {
          name: 'Out',
          type: 'bar',
          stack: 'traffic',
          itemStyle: { color: 'rgba(192, 57, 43, 0.65)' },
          data: hours.map((h) => -(h.peopleOut ?? 0)),
        },
        {
          name: NET_TRAFFIC_LABEL,
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2.5, color: '#8e44ad' },
          itemStyle: { color: '#8e44ad' },
          data: hours.map((h) => h.netTraffic ?? (h.peopleIn ?? 0) - (h.peopleOut ?? 0)),
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
  }, [location, hours, hasHourly, hasPeriod, d]);

  if (!hasHourly && !hasPeriod) {
    return (
      <section className="netTrafficSection">
        <h3 className="sectionTitle">{NET_TRAFFIC_SECTION_TITLE}</h3>
        <p className="hint">No in/out counts for this site.</p>
      </section>
    );
  }

  return (
    <section className="netTrafficSection">
      <h3 className="sectionTitle">{NET_TRAFFIC_SECTION_TITLE}</h3>
      <p className="netTrafficLead">{NET_TRAFFIC_LEAD}</p>
      {hasPeriod && d.totalIn != null && d.totalOut != null && d.totalNet != null ? (
        <p className="netTrafficTotals">
          <span className="netTrafficTotalsLine">
            {formatNetPeriodLine(d.totalIn, d.totalOut, d.totalNet)}
          </span>
          <span className="netTrafficTotalsMeta"> · this report period</span>
        </p>
      ) : null}
      {hasHourly ? (
        <ChartExportWrap onExport={exportChart}>
          <div ref={ref} className="chartPanel chartPanelShort" />
        </ChartExportWrap>
      ) : null}
    </section>
  );
}
