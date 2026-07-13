/** Pro (iPad-first): compact ops through tablet landscape + coarse pointers. */

import { useEffect, useState } from 'react';
import { navDrawerMediaQuery, shouldUseNavDrawer } from '@/lib/navDrawer';
import { readAlertUiTheme, subscribeAlertUiTheme } from '@/lib/uiTheme';

/** iPad / tablet landscape upper bound for Pro compact (cards + essential cols). */
export const PRO_COMPACT_MAX_PX = 1180;

export function proCompactMediaQuery(): string {
  return `(max-width: ${PRO_COMPACT_MAX_PX}px), (pointer: coarse)`;
}

export function shouldUseCompactOpsLayout(): boolean {
  if (typeof window === 'undefined') return false;
  if (readAlertUiTheme() === 'pro') {
    return window.matchMedia(proCompactMediaQuery()).matches;
  }
  return shouldUseNavDrawer();
}

export function useCompactOpsLayout(): boolean {
  const [compact, setCompact] = useState(() => shouldUseCompactOpsLayout());
  useEffect(() => {
    const sync = () => setCompact(shouldUseCompactOpsLayout());
    const mqClassic = window.matchMedia(navDrawerMediaQuery());
    const mqPro = window.matchMedia(proCompactMediaQuery());
    mqClassic.addEventListener('change', sync);
    mqPro.addEventListener('change', sync);
    const unsubTheme = subscribeAlertUiTheme(sync);
    return () => {
      mqClassic.removeEventListener('change', sync);
      mqPro.removeEventListener('change', sync);
      unsubTheme();
    };
  }, []);
  return compact;
}
