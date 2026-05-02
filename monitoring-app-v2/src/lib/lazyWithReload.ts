import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_FLAG = '__lm_chunk_reload_v1';

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Importing a module script failed')
  );
}

/**
 * Like `lazy()`, but if the dynamic import fails (typical after a deploy when hashed chunks
 * rotate), reload once so the browser picks up fresh `index.html` + entry bundle.
 */
export function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        /* ignore */
      }
      return mod;
    } catch (err) {
      if (typeof sessionStorage !== 'undefined' && isChunkLoadError(err)) {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          window.location.reload();
          return new Promise(() => {
            /* never resolves while reload runs */
          });
        }
      }
      throw err;
    }
  }) as LazyExoticComponent<T>;
}
