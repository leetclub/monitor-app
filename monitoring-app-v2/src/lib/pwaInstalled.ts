/** Persisted when the PWA fires `appinstalled` — used to hide install UI in a normal browser tab. */
export const PWA_INSTALLED_LS_KEY = 'leet-monitor:pwa-installed';

export function readPwaInstalledFromStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PWA_INSTALLED_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistPwaInstalledToStorage(): void {
  try {
    window.localStorage.setItem(PWA_INSTALLED_LS_KEY, '1');
  } catch {
    /* private mode / quota */
  }
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}
