import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getMonitoringRuntimeEnv } from '@/config/runtimeEnv';
import { apiUrl, loadGsiScript } from '@/lib/gsi';

export interface AuthUser {
  email: string;
  name?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => Promise<boolean>;
  /** Call after Google Identity returns a JWT (e.g. from GSI button). */
  completeGoogleCredential: (credential: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readDevUser(): AuthUser | null {
  const email = getMonitoringRuntimeEnv().VITE_DEV_USER_EMAIL?.trim();
  if (email) {
    return { email, name: 'Dev user' };
  }
  return null;
}

async function fetchJson(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; json: () => Promise<unknown> }> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const r = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  });
  return {
    ok: r.ok,
    json: () => r.json(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readDevUser());
  const [loading] = useState(false);

  // Restore Flask session on refresh (same-origin /api).
  useEffect(() => {
    const mock =
      getMonitoringRuntimeEnv().USE_MOCK_ACCESS === 'true' ||
      import.meta.env.VITE_USE_MOCK_ACCESS === 'true';
    if (mock || readDevUser()) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(apiUrl('/api/me'), { credentials: 'include' });
        if (!r.ok || cancelled) {
          return;
        }
        const j = (await r.json()) as { email?: string };
        if (j.email && !cancelled) {
          setUser({ email: j.email, name: j.email.split('@')[0] });
        }
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const completeGoogleCredential = useCallback(
    async (credential: string): Promise<boolean> => {
      const r = await fetchJson('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      if (!r.ok) {
        return false;
      }
      const me = await fetchJson('/api/me');
      if (!me.ok) {
        return false;
      }
      const data = (await me.json()) as { email?: string };
      if (data.email) {
        setUser({ email: data.email, name: data.email.split('@')[0] });
        return true;
      }
      return false;
    },
    [],
  );

  const signIn = useCallback(async (): Promise<boolean> => {
    const cid = getMonitoringRuntimeEnv().GOOGLE_CLIENT_ID?.trim();
    if (cid) {
      await loadGsiScript();
      return new Promise((resolve) => {
        if (!window.google?.accounts?.id) {
          resolve(false);
          return;
        }
        window.google.accounts.id.initialize({
          client_id: cid,
          callback: async (resp) => {
            const ok = await completeGoogleCredential(resp.credential);
            resolve(ok);
          },
        });
        window.google.accounts.id.prompt();
      });
    }

    try {
      const me = await fetchJson('/api/me');
      if (me.ok) {
        const j = (await me.json()) as { email?: string };
        if (j.email) {
          setUser({ email: j.email, name: j.email.split('@')[0] });
          return true;
        }
      }
    } catch {
      /* network */
    }

    const email = getMonitoringRuntimeEnv().VITE_DEV_USER_EMAIL?.trim();
    if (email) {
      setUser({ email, name: 'User' });
      return true;
    }

    console.info(
      '[auth] Set GOOGLE_CLIENT_ID (runtime or VITE_GOOGLE_CLIENT_ID) or VITE_DEV_USER_EMAIL for local dev.',
    );
    return false;
  }, [completeGoogleCredential]);

  const signOut = useCallback(async () => {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signIn,
      completeGoogleCredential,
      signOut,
    }),
    [user, loading, signIn, completeGoogleCredential, signOut],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
