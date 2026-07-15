/** Alert UI shell: classic (tactical Stitch) vs pro (iPad workspace). Color mode is separate. */

import { applyColorMode, bootColorMode, resolveColorMode } from '@/lib/colorMode';

export type AlertUiThemeId = 'classic' | 'pro';

export const ALERT_UI_THEME_STORAGE_KEY = 'alert_ui_theme_v1';

export const ALERT_UI_THEME_LABELS: Record<AlertUiThemeId, string> = {
  classic: 'Classic',
  pro: 'Pro',
};

const themeListeners = new Set<() => void>();

export function isAlertUiThemeId(v: unknown): v is AlertUiThemeId {
  return v === 'classic' || v === 'pro';
}

export function readAlertUiTheme(): AlertUiThemeId {
  try {
    const raw = localStorage.getItem(ALERT_UI_THEME_STORAGE_KEY);
    if (isAlertUiThemeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'classic';
}

export function applyAlertUiTheme(theme: AlertUiThemeId): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  // Color mode owns colorScheme / theme-color
  applyColorMode(resolveColorMode(theme));
}

export function persistAlertUiTheme(theme: AlertUiThemeId): void {
  try {
    localStorage.setItem(ALERT_UI_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  applyAlertUiTheme(theme);
  themeListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}

/** Subscribe to theme changes (ThemeToggle / persist). */
export function subscribeAlertUiTheme(cb: () => void): () => void {
  themeListeners.add(cb);
  return () => {
    themeListeners.delete(cb);
  };
}

/** Call before first paint / React mount. */
export function bootAlertUiTheme(): AlertUiThemeId {
  const theme = readAlertUiTheme();
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  bootColorMode(theme);
  return theme;
}
