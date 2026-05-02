from pathlib import Path

ROOT = Path(__file__).resolve().parent

AUTH = '''import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getMonitoringApiBase, getMonitoringRuntimeEnv } from '@/config/runtimeEnv';

export interface AuthUser {
  email: string;
  name?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Session via /api/me (credentials) or runtime dev email fallback. */
  signIn: () => Promise<boolean>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readDevUser(): AuthUser | null {
  const email = getMonitoringRuntimeEnv().VITE_DEV_USER_EMAIL?.trim();
  if (email) {
    return { email, name: 'Dev user' };
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readDevUser());
  const [loading] = useState(false);

  const signIn = useCallback(async (): Promise<boolean> => {
    try {
      const base = getMonitoringApiBase();
      const url = base ? `${base}/api/me` : '/api/me';
      const r = await fetch(url, { credentials: 'include' });
      if (r.ok) {
        const j = (await r.json()) as { email?: string; name?: string };
        if (j.email) {
          setUser({ email: j.email, name: j.name });
          return true;
        }
      }
    } catch {
      /* network / CORS */
    }
    const email = getMonitoringRuntimeEnv().VITE_DEV_USER_EMAIL?.trim();
    if (email) {
      setUser({ email, name: 'User' });
      return true;
    }
    console.info(
      '[auth] No session from /api/me and no dev email — configure OAuth or people-api session.',
    );
    return false;
  }, []);

  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signIn,
      signOut,
    }),
    [user, loading, signIn, signOut],
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
'''

LOGIN_PAGE = '''import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [pngOk, setPngOk] = useState(true);

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        {pngOk ? (
          <img
            className={styles.hero}
            src="/leet.png"
            alt=""
            width={200}
            height={200}
            onError={() => setPngOk(false)}
          />
        ) : (
          <img
            className={styles.hero}
            src="/leet.svg"
            alt=""
            width={180}
            height={180}
          />
        )}
        <h1 className={styles.title}>Leet Monitor</h1>
        <p className={styles.sub}>Sign in to continue</p>
        <button
          type="button"
          className={styles.primary}
          onClick={async () => {
            const ok = await signIn();
            if (ok) navigate('/', { replace: true });
          }}
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
'''

LAYOUT_SIGNIN = '''          ) : (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={async () => {
                const ok = await signIn();
                if (ok) {
                  /* stay on page; user state updates */
                }
              }}
            >
              Sign in
            </button>
          )}'''

# Layout: replace simple onClick={signIn} with async - read file and patch


def main() -> None:
    (ROOT / 'src/context/AuthContext.tsx').write_text(AUTH, encoding='utf-8')
    (ROOT / 'src/pages/LoginPage.tsx').write_text(LOGIN_PAGE, encoding='utf-8')

    layout = ROOT / 'src/components/Layout.tsx'
    lt = layout.read_text(encoding='utf-8')
    old = '''          ) : (
            <button type="button" className={styles.primaryBtn} onClick={signIn}>
              Sign in
            </button>
          )}'''
    new = '''          ) : (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={async () => {
                await signIn();
              }}
            >
              Sign in
            </button>
          )}'''
    if old not in lt:
        raise SystemExit('Layout signIn block not found')
    layout.write_text(lt.replace(old, new, 1), encoding='utf-8')

    print('auth ok')


if __name__ == '__main__':
    main()
