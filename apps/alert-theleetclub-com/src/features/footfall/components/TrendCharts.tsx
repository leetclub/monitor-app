import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import * as echarts from 'echarts';
import type { LocationReport } from '@/features/footfall/lib/types';
import { ChartExportButton } from '@/features/footfall/components/ChartExportWrap';
import { chartFilename, downloadChartPng } from '@/features/footfall/lib/chartExport';
import { useNightChart } from '@/features/footfall/NightChartContext';
import { footfallChartChrome } from '@/features/footfall/lib/footfallChartChrome';

/** Separate hourly trend panels: footfall, cups, revenue (KD). */
export function TrendCharts({ location }: { location: LocationReport }) {
  const footRef = useRef<HTMLDivElement>(null);
  const cupsRef = useRef<HTMLDivElement>(null);
  const revRef = useRef<HTMLDivElement>(null);
  const footChart = useRef<echarts.ECharts | null>(null);
  const cupsChart = useRef<echarts.ECharts | null>(null);
  const revChart = useRef<echarts.ECharts | null>(null);
  const nightMode = useNightChart();
  const hours = location.hours;
  const labels = hours.map((h) => h.label);

  const exportFoot = useCallback(() => {
    if (footChart.current) {
      downloadChartPng(footChart.current, chartFilename([location.locationName, 'trend-footfall']));
    }
  }, [location.locationName]);

  const exportCups = useCallback(() => {
    if (cupsChart.current) {
      downloadChartPng(cupsChart.current, chartFilename([location.locationName, 'trend-cups']));
    }
  }, [location.locationName]);

  const exportRev = useCallback(() => {
    if (revChart.current) {
      downloadChartPng(revChart.current, chartFilename([location.locationName, 'trend-revenue']));
    }
  }, [location.locationName]);

  useEffect(() => {
    const chrome = footfallChartChrome(nightMode);
    const charts: echarts.ECharts[] = [];
    const mk = (
      el: HTMLDivElement | null,
      title: string,
      series: echarts.SeriesOption[],
      store: MutableRefObject<echarts.ECharts | null>,
    ) => {
      if (!el) return;
      const c = echarts.init(el);
      store.current = c;
      c.setOption({
        backgroundColor: chrome.backgroundColor,
        title: {
          text: title,
          left: 'center',
          textStyle: { fontSize: 12, color: chrome.titleColor },
        },
        tooltip: {
          trigger: 'axis',
          backgroundColor: chrome.tooltipBg,
          textStyle: { color: chrome.tooltipText },
        },
        legend: { textStyle: { color: chrome.legend } },
        grid: { left: 48, right: 16, top: 36, bottom: 28 },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: false,
          axisLabel: { color: chrome.axis },
          axisLine: { lineStyle: { color: chrome.axis } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: chrome.axis },
          splitLine: { lineStyle: { color: nightMode ? 'rgba(136,153,170,0.15)' : '#eee' } },
        },
        series,
      });
      charts.push(c);
    };

    mk(
      footRef.current,
      'Hourly footfall',
      [
        {
          type: 'line',
          smooth: true,
          areaStyle: { color: 'rgba(94,184,232,0.35)' },
          lineStyle: { color: '#5eb8e8' },
          data: hours.map((h) => h.footfall),
        },
      ],
      footChart,
    );
    mk(
      cupsRef.current,
      'Hourly cups sold',
      [
        {
          type: 'line',
          smooth: true,
          lineStyle: { color: '#2e9e5a', width: 2 },
          data: hours.map((h) => h.cups),
        },
        {
          type: 'line',
          smooth: true,
          lineStyle: { type: 'dashed', color: '#e67e22' },
          data: hours.map((h) => h.aspiredCups),
          name: 'Aspired',
        },
      ],
      cupsChart,
    );
    mk(
      revRef.current,
      'Hourly revenue (KD)',
      [
        {
          type: 'bar',
          itemStyle: { color: 'rgba(230,126,34,0.55)' },
          data: hours.map((h) => h.revenueKd),
        },
      ],
      revChart,
    );

    const onResize = () => charts.forEach((c) => c.resize());
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      charts.forEach((c) => c.dispose());
      footChart.current = null;
      cupsChart.current = null;
      revChart.current = null;
    };
  }, [location, hours, labels, nightMode]);

  return (
    <div className="trendChartsRow">
      <div className="chartExportWrap chartExportWrapMini">
        <div className="chartExportToolbar">
          <ChartExportButton onExport={exportFoot} label="Download footfall trend as PNG" />
        </div>
        <div ref={footRef} className={`chartPanel chartPanelMini${nightMode ? ' chartPanelNight' : ''}`} />
      </div>
      <div className="chartExportWrap chartExportWrapMini">
        <div className="chartExportToolbar">
          <ChartExportButton onExport={exportCups} label="Download cups trend as PNG" />
        </div>
        <div ref={cupsRef} className={`chartPanel chartPanelMini${nightMode ? ' chartPanelNight' : ''}`} />
      </div>
      <div className="chartExportWrap chartExportWrapMini">
        <div className="chartExportToolbar">
          <ChartExportButton onExport={exportRev} label="Download revenue trend as PNG" />
        </div>
        <div ref={revRef} className={`chartPanel chartPanelMini${nightMode ? ' chartPanelNight' : ''}`} />
      </div>
    </div>
  );
}
