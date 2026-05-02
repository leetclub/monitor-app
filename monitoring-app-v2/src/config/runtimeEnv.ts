/**
 * Build-time (Vite) and runtime (Docker entrypoint → /config.js) configuration.
 * Secrets from Google Script Properties must never be embedded here — only public flags/URLs.
 */
export interface MonitoringRuntimeEnv {
  /** Base URL for people-api / BFF (no trailing slash). Empty = same-origin. */
  MONITORING_API_URL?: string;
  USE_MOCK_ACCESS?: string;
  VITE_MOCK_ALLOWED_TABS?: string;
  VITE_DEV_USER_EMAIL?: string;
  ACCESS_ALLOWED_DOMAIN?: string;
  ACCESS_TEST_MODE?: string;
  /** Google OAuth Web client ID (public). */
  GOOGLE_CLIENT_ID?: string;
  /** When true, Red Alert tab uses bundled mock snapshot (no `/api/red-alert/*` call). */
  USE_MOCK_RED_ALERT?: string;
}

declare global {
  interface Window {
    __MONITORING_ENV__?: MonitoringRuntimeEnv;
  }
}

function fromWindow(): MonitoringRuntimeEnv {
  if (typeof window === 'undefined') {
    return {};
  }
  return { ...(window.__MONITORING_ENV__ || {}) };
}

function fromVite(): MonitoringRuntimeEnv {
  return {
    MONITORING_API_URL: import.meta.env.VITE_MONITORING_API_URL,
    USE_MOCK_ACCESS: import.meta.env.VITE_USE_MOCK_ACCESS,
    VITE_MOCK_ALLOWED_TABS: import.meta.env.VITE_MOCK_ALLOWED_TABS,
    VITE_DEV_USER_EMAIL: import.meta.env.VITE_DEV_USER_EMAIL,
    ACCESS_ALLOWED_DOMAIN: import.meta.env.VITE_ACCESS_ALLOWED_DOMAIN,
    ACCESS_TEST_MODE: import.meta.env.VITE_ACCESS_TEST_MODE,
    GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    USE_MOCK_RED_ALERT: import.meta.env.VITE_USE_MOCK_RED_ALERT,
  };
}

const GOOGLE_WEB_CLIENT_RE = /^\d+-[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/;

/** If env accidentally holds base64 of the client ID, decode once. */
function normalizeGoogleClientId(raw?: string | null): string | undefined {
  if (raw == null || typeof raw !== 'string') {
    return undefined;
  }
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  if (GOOGLE_WEB_CLIENT_RE.test(t)) {
    return t;
  }
  try {
    const decoded = atob(t);
    if (GOOGLE_WEB_CLIENT_RE.test(decoded)) {
      return decoded;
    }
  } catch {
    /* not valid base64 */
  }
  return t;
}

/** Window config overrides Vite env (production container). */
export function getMonitoringRuntimeEnv(): MonitoringRuntimeEnv {
  const w = fromWindow();
  const v = fromVite();
  const merged: MonitoringRuntimeEnv = { ...v, ...w };
  // config.js may set GOOGLE_CLIENT_ID to null when unset; don't wipe Vite dev fallback
  const rawCid = merged.GOOGLE_CLIENT_ID;
  if (rawCid == null || (typeof rawCid === 'string' && rawCid.trim() === '')) {
    merged.GOOGLE_CLIENT_ID = v.GOOGLE_CLIENT_ID;
  } else {
    merged.GOOGLE_CLIENT_ID = normalizeGoogleClientId(merged.GOOGLE_CLIENT_ID) ?? merged.GOOGLE_CLIENT_ID;
  }
  return merged;
}

export function getMonitoringApiBase(): string {
  let base = getMonitoringRuntimeEnv().MONITORING_API_URL?.trim() ?? '';
  if (!base) {
    return '';
  }
  base = base.replace(/\/$/, '');

  // Misconfig: MONITORING_API_URL=http://same-host:8080 on an https site → mixed content + CSP
  // connect-src blocks. Same-origin /api via ingress is correct — drop the bad base.
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && base.startsWith('http://')) {
    try {
      const u = new URL(base);
      if (u.hostname === window.location.hostname) {
        return '';
      }
    } catch {
      /* ignore invalid URL */
    }
  }

  return base;
}

export function isMockAccessEnabled(): boolean {
  return getMonitoringRuntimeEnv().USE_MOCK_ACCESS === 'true';
}

export function isMockRedAlertSnapshotEnabled(): boolean {
  return getMonitoringRuntimeEnv().USE_MOCK_RED_ALERT === 'true';
}
