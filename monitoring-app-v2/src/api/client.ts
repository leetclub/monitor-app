import { getMonitoringApiBase } from '@/config/runtimeEnv';

/**
 * Base URL for the monitoring BFF / people-api (browser must not hold dashboard-access secret).
 * In dev, Vite can proxy `/api` to your Flask app — see vite.config.ts.
 * In production, prefer runtime `window.__MONITORING_ENV__` from `/config.js`.
 */
export function getApiBaseUrl(): string {
  return getMonitoringApiBase();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const base = getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${base || ''}${path}`;
  const headers = new Headers(init?.headers);
  if (init?.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, {
    ...init,
    headers,
    credentials: init?.credentials ?? 'include',
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error?: string }).error)
        : res.statusText;
    throw new ApiError(msg || `HTTP ${res.status}`, res.status, data);
  }
  return data as T;
}
