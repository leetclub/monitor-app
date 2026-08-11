/** Which host / build profile is running. */
export type SiteProfile = 'target-only' | 'full';

const SEGMENT_HINTS_NO_DATES: Record<string, string> = {
  ALL: 'KU + MOH + O2',
  KU: 'Campus locations',
  MOH: 'Ministry hospitals',
  O2: 'O2 venues',
};

export function siteProfile(): SiteProfile {
  const env = import.meta.env.VITE_SITE_PROFILE;
  if (env === 'target-only' || env === 'full') return env;
  if (typeof window !== 'undefined') {
    if (window.location.hostname === 'target.theleetclub.com') return 'target-only';
  }
  return 'full';
}

/** target.theleetclub.com — Targets tab only, no Analytics. */
export function isTargetOnlySite(): boolean {
  return siteProfile() === 'target-only';
}

/** Hide calendar dates in the operator Targets UI (target.theleetclub.com). */
export function hideDateLabels(): boolean {
  return isTargetOnlySite();
}

export function showAnalyticsTab(): boolean {
  return !isTargetOnlySite();
}

export function segmentTabHint(segmentId: string, defaultHint: string): string {
  if (!hideDateLabels()) return defaultHint;
  return SEGMENT_HINTS_NO_DATES[segmentId] ?? defaultHint;
}

export function weekdayShortUtc(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
