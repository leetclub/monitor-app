import { documentIsDarkMode } from '@/lib/colorMode';

/** KPI / table metric colors that stay readable on Alert dark panels. */
export function ffMetricColors() {
  if (documentIsDarkMode()) {
    return {
      proxy: '#fdba74',
      actual: '#4ade80',
      unique: '#fdba74',
      none: '#94a3b8',
      mirror: '#7dd3fc',
      pctHigh: '#4ade80',
      pctMid: '#93c5fd',
      pctLow: '#fdba74',
      pctBad: '#f87171',
    };
  }
  return {
    proxy: '#b45309',
    actual: '#2e9e5a',
    unique: '#b45309',
    none: '#94a3b8',
    mirror: '#5eb8e8',
    pctHigh: '#15803d',
    pctMid: '#1d4ed8',
    pctLow: '#b45309',
    pctBad: '#dc2626',
  };
}
