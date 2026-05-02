import { getMonitoringApiBase } from '@/config/runtimeEnv';

/** Base path for API (empty = same-origin /api behind Ingress or Vite proxy). */
export function apiUrl(path: string): string {
  const base = getMonitoringApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export function loadGsiScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const id = 'google-gsi-client';
    if (document.getElementById(id)) {
      const t = window.setInterval(() => {
        if (window.google?.accounts?.id) {
          window.clearInterval(t);
          resolve();
        }
      }, 50);
      window.setTimeout(() => {
        window.clearInterval(t);
        if (!window.google?.accounts?.id) {
          reject(new Error('Google GSI load timeout'));
        }
      }, 15000);
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google GSI'));
    document.head.appendChild(s);
  });
}
