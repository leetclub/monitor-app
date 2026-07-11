import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiJson } from '@/lib/api';
import {
  defaultStoredRedFlagsColumns,
  normalizeStoredRedFlagsColumns,
  type StoredRedFlagsColumns,
} from '@/features/redflags/redFlagsColumnVisibility';

export type AlertUiPrefsResponse = {
  email?: string;
  prefs?: {
    redFlagsColumns?: StoredRedFlagsColumns;
  };
  updatedAt?: string | null;
};

function localCacheKey(email: string): string {
  return `alert_ui_prefs_redflags_v1:${email.toLowerCase()}`;
}

function readLocalColumns(email: string): StoredRedFlagsColumns | null {
  try {
    const raw = localStorage.getItem(localCacheKey(email));
    if (!raw) return null;
    return normalizeStoredRedFlagsColumns(JSON.parse(raw) as StoredRedFlagsColumns);
  } catch {
    return null;
  }
}

function writeLocalColumns(email: string, stored: StoredRedFlagsColumns): void {
  try {
    localStorage.setItem(localCacheKey(email), JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

export type RedFlagsColumnSyncState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function useRedFlagsColumnPrefs(userEmail: string | null | undefined) {
  const email = (userEmail ?? '').trim().toLowerCase();
  const [stored, setStored] = useState<StoredRedFlagsColumns>(() => defaultStoredRedFlagsColumns());
  const [syncState, setSyncState] = useState<RedFlagsColumnSyncState>('idle');
  const saveTimerRef = useRef<number | null>(null);
  const latestStoredRef = useRef(stored);
  latestStoredRef.current = stored;

  useEffect(() => {
    if (!email) {
      setStored(defaultStoredRedFlagsColumns());
      setSyncState('idle');
      return;
    }
    const cached = readLocalColumns(email);
    if (cached) setStored(cached);
    setSyncState('loading');
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiGet<AlertUiPrefsResponse>('/api/alert/me/ui-prefs');
        if (cancelled) return;
        const remote = res.prefs?.redFlagsColumns;
        if (remote) {
          const normalized = normalizeStoredRedFlagsColumns(remote);
          setStored(normalized);
          writeLocalColumns(email, normalized);
        } else if (!cached) {
          setStored(defaultStoredRedFlagsColumns());
        }
        setSyncState('saved');
      } catch {
        if (!cancelled) {
          if (!cached) setStored(defaultStoredRedFlagsColumns());
          setSyncState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  const persistRemote = useCallback(
    (next: StoredRedFlagsColumns) => {
      if (!email) return;
      writeLocalColumns(email, next);
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
      setSyncState('saving');
      saveTimerRef.current = window.setTimeout(() => {
        void (async () => {
          try {
            await apiJson(
              '/api/alert/me/ui-prefs',
              { prefs: { redFlagsColumns: latestStoredRef.current } },
              'PUT',
            );
            setSyncState('saved');
          } catch {
            setSyncState('error');
          }
        })();
      }, 450);
    },
    [email],
  );

  const setColumns = useCallback(
    (next: StoredRedFlagsColumns) => {
      const normalized = normalizeStoredRedFlagsColumns(next);
      setStored(normalized);
      persistRemote(normalized);
    },
    [persistRemote],
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  return { stored, setColumns, syncState, emailReady: !!email };
}
