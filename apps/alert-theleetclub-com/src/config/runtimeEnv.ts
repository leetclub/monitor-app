/**
 * Build-time (Vite) and runtime (Docker entrypoint → /config.js) configuration.
 * Only public flags/URLs here — never secrets.
 */
export interface AlertRuntimeEnv {
  /** Base URL for API (no trailing slash). Empty = same-origin. */
  ALERT_API_URL?: string;
  /** Google OAuth Web client ID (public). */
  GOOGLE_CLIENT_ID?: string;
  /**
   * Public URL of Leet Monitor v2 (no trailing slash). Used for “edit org access” links.
   * Set via container env MONITOR_APP_URL or Vite `VITE_MONITOR_APP_URL`.
   */
  MONITOR_APP_URL?: string;
  /** Optional local dev: bypass login. */
  VITE_DEV_USER_EMAIL?: string;
}

declare global {
  interface Window {
    __ALERT_ENV__?: AlertRuntimeEnv;
  }
}

function fromWindow(): AlertRuntimeEnv {
  if (typeof window === 'undefined') return {};
  return { ...(window.__ALERT_ENV__ || {}) };
}

function fromVite(): AlertRuntimeEnv {
  return {
    ALERT_API_URL: import.meta.env.VITE_ALERT_API_URL,
    GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    MONITOR_APP_URL: import.meta.env.VITE_MONITOR_APP_URL,
    VITE_DEV_USER_EMAIL: import.meta.env.VITE_DEV_USER_EMAIL,
  };
}

const GOOGLE_WEB_CLIENT_RE = /^\d+-[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/;

function normalizeGoogleClientId(raw?: string | null): string | undefined {
  if (raw == null || typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  if (GOOGLE_WEB_CLIENT_RE.test(t)) return t;
  try {
    const decoded = atob(t);
    if (GOOGLE_WEB_CLIENT_RE.test(decoded)) return decoded;
  } catch {
    /* not base64 */
  }
  return t;
}

/** Window config overrides Vite env (production container). */
export function getAlertRuntimeEnv(): AlertRuntimeEnv {
  const w = fromWindow();
  const v = fromVite();
  const merged: AlertRuntimeEnv = { ...v, ...w };

  const rawCid = merged.GOOGLE_CLIENT_ID;
  if (rawCid == null || (typeof rawCid === 'string' && rawCid.trim() === '')) {
    merged.GOOGLE_CLIENT_ID = v.GOOGLE_CLIENT_ID;
  } else {
    merged.GOOGLE_CLIENT_ID =
      normalizeGoogleClientId(merged.GOOGLE_CLIENT_ID) ?? merged.GOOGLE_CLIENT_ID;
  }

  return merged;
}

export function getAlertApiBase(): string {
  let base = getAlertRuntimeEnv().ALERT_API_URL?.trim() ?? '';
  if (!base) return '';
  base = base.replace(/\/$/, '');

  // Same safety guard as v2: if someone sets http://same-host on an https page, drop base and use same-origin.
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && base.startsWith('http://')) {
    try {
      const u = new URL(base);
      if (u.hostname === window.location.hostname) return '';
    } catch {
      /* ignore */
    }
  }

  return base;
}

/** Base URL for Monitor v2 — used only for deep links (never secrets). */
export function getMonitorAppUrl(): string {
  const merged = getAlertRuntimeEnv();
  const raw = merged.MONITOR_APP_URL?.trim() ?? '';
  if (raw) return raw.replace(/\/$/, '');
  return '';
}

