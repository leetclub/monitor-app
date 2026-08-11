/** Shared echarts chrome for Alert Footfall dark / light. */
export function footfallChartChrome(nightMode: boolean): {
  backgroundColor: string;
  titleColor: string;
  muted: string;
  axis: string;
  legend: string;
  tooltipBg: string;
  tooltipText: string;
} {
  if (nightMode) {
    return {
      backgroundColor: '#0a0e14',
      titleColor: '#f0f8ff',
      muted: '#8899aa',
      axis: '#8899aa',
      legend: '#aab8c8',
      tooltipBg: 'rgba(10, 14, 20, 0.96)',
      tooltipText: '#e8f8ff',
    };
  }
  return {
    backgroundColor: '#ffffff',
    titleColor: '#0f2942',
    muted: '#64748b',
    axis: '#64748b',
    legend: '#334155',
    tooltipBg: 'rgba(255,255,255,0.98)',
    tooltipText: '#0f2942',
  };
}
