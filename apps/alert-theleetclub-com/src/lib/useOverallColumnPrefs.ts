import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiJson } from '@/lib/api';
import {
  defaultStoredOverallColumns,
  normalizeStoredOverallColumns,
  type StoredOverallColumns,
} from '@/features/overall/overallColumnVisibility';
import type { RedFlagsColumnSyncState } from '@/lib/useRedFlagsColumnPrefs';

type AlertUiPrefsResponse = {
  email?: string;
  prefs?: {
    overallColumns?: StoredOverallColumns;
  };
  updatedAt?: string | null;
};

function localCacheKey(email: string): string {
  return `alert_ui_prefs_overall_v1:${email.toLowerCase()}`;
}

function readLocalColumns(email: string): StoredOverallColumns | null {
  try {
    const raw = localStorage.getItem(localCacheKey(email));
    if (!raw) return null;
    return normalizeStoredOverallColumns(JSON.parse(raw) as StoredOverallColumns);
  } catch {
    return null;
  }
}

function writeLocalColumns(email: string, stored: StoredOverallColumns): void {
  try {
    localStorage.setItem(localCacheKey(email), JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

export function useOverallColumnPrefs(userEmail: string | null | undefined) {
  const email = (userEmail ?? '').trim().toLowerCase();
  const [stored, setStored] = useState<StoredOverallColumns>(() => defaultStoredOverallColumns());
  const [syncState, setSyncState] = useState<RedFlagsColumnSyncState>('idle');
  const saveTimerRef = useRef<number | null>(null);
  const latestStoredRef = useRef(stored);
  latestStoredRef.current = stored;

  useEffect(() => {
    if (!email) {
      setStored(defaultStoredOverallColumns());
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
        const remote = res.prefs?.overallColumns;
        if (remote) {
          const normalized = normalizeStoredOverallColumns(remote);
          setStored(normalized);
          writeLocalColumns(email, normalized);
        } else if (!cached) {
          setStored(defaultStoredOverallColumns());
        }
        setSyncState('saved');
      } catch {
        if (!cancelled) {
          if (!cached) setStored(defaultStoredOverallColumns());
          setSyncState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  const persistRemote = useCallback(
    (next: StoredOverallColumns) => {
      if (!email) return;
      writeLocalColumns(email, next);
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
      setSyncState('saving');
      saveTimerRef.current = window.setTimeout(() => {
        void (async () => {
          try {
            await apiJson(
              '/api/alert/me/ui-prefs',
              { prefs: { overallColumns: latestStoredRef.current } },
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
    (next: StoredOverallColumns) => {
      const normalized = normalizeStoredOverallColumns(next);
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
