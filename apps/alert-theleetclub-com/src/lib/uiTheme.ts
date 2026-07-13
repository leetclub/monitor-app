/** Alert UI theme: classic (tactical Stitch) vs pro (bold dark command floor). */

export type AlertUiThemeId = 'classic' | 'pro';

export const ALERT_UI_THEME_STORAGE_KEY = 'alert_ui_theme_v1';

export const ALERT_UI_THEME_LABELS: Record<AlertUiThemeId, string> = {
  classic: 'Classic',
  pro: 'Pro',
};

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
  root.style.colorScheme = 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'pro' ? '#050608' : '#0c0f14');
  }
}

export function persistAlertUiTheme(theme: AlertUiThemeId): void {
  try {
    localStorage.setItem(ALERT_UI_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  applyAlertUiTheme(theme);
}

/** Call before first paint / React mount. */
export function bootAlertUiTheme(): AlertUiThemeId {
  const theme = readAlertUiTheme();
  applyAlertUiTheme(theme);
  return theme;
}
