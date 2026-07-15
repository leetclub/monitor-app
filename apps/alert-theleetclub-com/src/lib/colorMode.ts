/** Light / dark color mode — independent of Classic vs Pro shell. */

export type AlertColorMode = 'light' | 'dark';
export type AlertShellId = 'classic' | 'pro';

export const ALERT_COLOR_MODE_STORAGE_KEY = 'alert_ui_color_mode_v1';

export const ALERT_COLOR_MODE_LABELS: Record<AlertColorMode, string> = {
  light: 'Light',
  dark: 'Dark',
};

const modeListeners = new Set<() => void>();

export function isAlertColorMode(v: unknown): v is AlertColorMode {
  return v === 'light' || v === 'dark';
}

export function readStoredColorMode(): AlertColorMode | null {
  try {
    const raw = localStorage.getItem(ALERT_COLOR_MODE_STORAGE_KEY);
    if (isAlertColorMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

function currentShell(): AlertShellId {
  if (typeof document === 'undefined') return 'classic';
  return document.documentElement.getAttribute('data-theme') === 'pro' ? 'pro' : 'classic';
}

/** Explicit choice, or shell default (Classic→dark, Pro→light) until the user picks. */
export function resolveColorMode(theme?: AlertShellId): AlertColorMode {
  const stored = readStoredColorMode();
  if (stored) return stored;
  const shell = theme ?? currentShell();
  return shell === 'pro' ? 'light' : 'dark';
}

export function applyColorMode(mode: AlertColorMode): void {
  const root = document.documentElement;
  root.setAttribute('data-mode', mode);
  root.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const shell = root.getAttribute('data-theme');
    if (mode === 'light') {
      meta.setAttribute('content', shell === 'pro' ? '#e8edf3' : '#f4f1ec');
    } else {
      meta.setAttribute('content', shell === 'pro' ? '#0b1220' : '#0c0f14');
    }
  }
}

export function persistColorMode(mode: AlertColorMode): void {
  try {
    localStorage.setItem(ALERT_COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  applyColorMode(mode);
  modeListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeColorMode(cb: () => void): () => void {
  modeListeners.add(cb);
  return () => {
    modeListeners.delete(cb);
  };
}

export function bootColorMode(theme?: AlertShellId): AlertColorMode {
  const mode = resolveColorMode(theme);
  applyColorMode(mode);
  return mode;
}

/** Chart / canvas helpers — prefer data-mode over shell. */
export function documentIsDarkMode(): boolean {
  if (typeof document === 'undefined') return true;
  const mode = document.documentElement.getAttribute('data-mode');
  if (mode === 'light') return false;
  if (mode === 'dark') return true;
  return document.documentElement.getAttribute('data-theme') !== 'pro';
}
