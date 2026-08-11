import { HOURLY_PALETTE } from '@/features/footfall/lib/hourlyChartPalette';

export type HourlyChartTheme = {
  chartBg: string;
  soldBar: string;
  titleColor: string;
  axisMuted: string;
  tooltipBg: string;
  tooltipText: string;
  legendText: string;
  footfallGlow: string;
  footfallLine: string;
  footfallAreaTop: string;
  footfallAreaBottom: string;
  footfallAxis: string;
  footfallGrid: string;
  targetFill: string;
  targetBorder: string;
  cupsAxis: string;
  gapBadgeBg: string;
  gapBand: string;
  weakBand: string;
  weakBandBorder: string;
  weakLabel: string;
  revenueLine: string;
  revenueItem: string;
  tooltipBorder: string;
  okText: string;
};

const DAY: HourlyChartTheme = {
  chartBg: '#ffffff',
  soldBar: '#2e9e5a',
  titleColor: HOURLY_PALETTE.title,
  axisMuted: HOURLY_PALETTE.subtext,
  tooltipBg: 'rgba(255,255,255,0.98)',
  tooltipText: HOURLY_PALETTE.title,
  legendText: HOURLY_PALETTE.subtext,
  footfallGlow: HOURLY_PALETTE.footfallLine,
  footfallLine: HOURLY_PALETTE.footfallLine,
  footfallAreaTop: HOURLY_PALETTE.footfallAreaTop,
  footfallAreaBottom: HOURLY_PALETTE.footfallAreaBottom,
  footfallAxis: HOURLY_PALETTE.footfallAxis,
  footfallGrid: HOURLY_PALETTE.footfallGrid,
  targetFill: HOURLY_PALETTE.targetFill,
  targetBorder: HOURLY_PALETTE.targetBorder,
  cupsAxis: HOURLY_PALETTE.cupsAxis,
  gapBadgeBg: HOURLY_PALETTE.gapBadgeBg,
  gapBand: HOURLY_PALETTE.gapBand,
  weakBand: HOURLY_PALETTE.weakBand,
  weakBandBorder: HOURLY_PALETTE.weakBandBorder,
  weakLabel: HOURLY_PALETTE.weakLabel,
  revenueLine: HOURLY_PALETTE.revenueLine,
  revenueItem: HOURLY_PALETTE.revenueItem,
  tooltipBorder: HOURLY_PALETTE.tooltipBorder,
  okText: HOURLY_PALETTE.okText,
};

const NIGHT: HourlyChartTheme = {
  chartBg: '#0a0e14',
  soldBar: '#39ff14',
  titleColor: '#f0f8ff',
  axisMuted: '#8899aa',
  tooltipBg: 'rgba(10, 14, 20, 0.96)',
  tooltipText: '#e8f8ff',
  legendText: '#aab8c8',
  footfallGlow: '#00e5ff',
  footfallLine: '#00e5ff',
  footfallAreaTop: 'rgba(0, 229, 255, 0.45)',
  footfallAreaBottom: 'rgba(123, 47, 255, 0.04)',
  footfallAxis: '#00e5ff',
  footfallGrid: 'rgba(0, 229, 255, 0.08)',
  targetFill: 'rgba(255, 140, 0, 0.18)',
  targetBorder: '#ff9f43',
  cupsAxis: '#ff9f43',
  gapBadgeBg: '#ff3366',
  gapBand: 'rgba(255, 51, 102, 0.14)',
  weakBand: 'rgba(255, 51, 102, 0.12)',
  weakBandBorder: 'rgba(255, 110, 199, 0.45)',
  weakLabel: '#ff6ec7',
  revenueLine: 'rgba(255, 159, 67, 0.7)',
  revenueItem: '#ff9f43',
  tooltipBorder: 'rgba(0, 229, 255, 0.35)',
  okText: '#39ff14',
};

export function hourlyChartTheme(nightMode: boolean): HourlyChartTheme {
  return nightMode ? NIGHT : DAY;
}
