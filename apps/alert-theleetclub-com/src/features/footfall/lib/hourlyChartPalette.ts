/** Original footfall vs capture palette (blue exposure · green sold · orange target · red gap). */
export const HOURLY_PALETTE = {
  footfallLine: '#1a5f8f',
  footfallAreaTop: 'rgba(26, 95, 143, 0.55)',
  footfallAreaBottom: 'rgba(26, 95, 143, 0.04)',
  footfallAxis: '#1a5f8f',
  footfallGrid: 'rgba(26, 95, 143, 0.14)',

  targetFill: 'rgba(230, 126, 34, 0.22)',
  targetBorder: '#d35400',
  cupsAxis: '#d35400',

  soldBadgeText: '#1e8449',
  soldBadgeBorder: '#2e9e5a',
  soldBadgeBg: 'rgba(255, 255, 255, 0.97)',

  gapText: '#fff',
  gapBadgeBg: '#c0392b',
  gapBadgeBorder: '#922b21',
  gapBand: 'rgba(192, 57, 43, 0.12)',
  weakBand: 'rgba(192, 57, 43, 0.14)',
  weakBandBorder: 'rgba(192, 57, 43, 0.45)',
  weakLabel: '#922b21',

  revenueLine: 'rgba(230, 126, 34, 0.55)',
  revenueItem: '#e67e22',
  title: '#0f2942',
  subtext: '#64748b',
  tooltipBorder: '#e8b4b0',
  okText: '#1e8449',
} as const;
