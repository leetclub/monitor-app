type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;
import { apiUrl } from '@/lib/gsi';

async function fetchWithRetry(path: string, init: RequestInit, attempts = 3): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(apiUrl(path), init);
    last = res;
    if (res.ok || (res.status !== 503 && res.status !== 502)) {
      return res;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  return last!;
}

export async function apiGet<T extends Json>(path: string): Promise<T> {
  const res = await fetchWithRetry(path, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`GET ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Download a binary file (e.g. QA report PDF) with session cookies. */
export async function apiDownloadFile(path: string, filename: string): Promise<void> {
  const res = await fetchWithRetry(path, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Download failed (${res.status}) ${text.slice(0, 160)}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function apiJson<T extends Json>(path: string, body: unknown, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} failed (${res.status}) ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

