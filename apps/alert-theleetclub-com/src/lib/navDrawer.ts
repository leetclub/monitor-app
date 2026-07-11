/** Viewports ≤ this width use phone drawer (icon rail always visible). */
export const NAV_DRAWER_MAX_PX = 767;

/** Labeled sidebar only when viewport is at least this wide AND user expanded. */
export const NAV_FULL_MIN_PX = 1680;

export const NAV_EXPANDED_KEY = 'alert_nav_expanded_v1';

export type NavLayout = 'drawer' | 'rail' | 'full';

export function navDrawerMediaQuery(): string {
  return `(max-width: ${NAV_DRAWER_MAX_PX}px)`;
}

export function navFullMediaQuery(): string {
  return `(min-width: ${NAV_FULL_MIN_PX}px)`;
}

export function shouldUseNavDrawer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(navDrawerMediaQuery()).matches;
}

export function canShowFullNav(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(navFullMediaQuery()).matches;
}

export function readNavExpandedPreference(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(NAV_EXPANDED_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    /* ignore */
  }
  return null;
}

export function persistNavExpandedPreference(expanded: boolean): void {
  try {
    localStorage.setItem(NAV_EXPANDED_KEY, expanded ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** drawer = off-canvas; rail = icon strip (desktop default); full = labels when wide + expanded. */
export function resolveNavLayout(expandedOverride: boolean | null): NavLayout {
  if (typeof window === 'undefined') return 'rail';
  if (shouldUseNavDrawer()) return 'drawer';
  if (expandedOverride === true) return 'full';
  return 'rail';
}

/** Collapse to icon rail when the window is too narrow for a labeled sidebar. */
export function coerceNavExpandedForViewport(expanded: boolean | null): boolean | null {
  return expanded;
}
