import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { loadGsiScript } from '@/lib/gsi';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ColorModeToggle } from '@/components/ColorModeToggle';

export function LoginPage() {
  const { user, loading, signIn, completeGoogleCredential } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const gsiRef = useRef<HTMLDivElement>(null);
  const signedOut =
    (location.state as { signedOut?: boolean } | null)?.signedOut === true ||
    (typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem('leet-alert-signed-out') === '1');

  const clientId = getAlertRuntimeEnv().GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    if (!loading && user) {
      try {
        sessionStorage.removeItem('leet-alert-signed-out');
      } catch {
        /* ignore */
      }
      navigate('/', { replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!clientId || !gsiRef.current || loading || user) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadGsiScript();
        if (cancelled || !gsiRef.current || !(window as any).google?.accounts?.id) return;
        const gsi = (window as any).google.accounts.id;
        gsi.initialize({
          client_id: clientId,
          callback: async (resp: { credential?: string }) => {
            try {
              sessionStorage.removeItem('leet-alert-signed-out');
            } catch {
              /* ignore */
            }
            const ok = await completeGoogleCredential(String(resp?.credential || ''));
            if (ok) navigate('/', { replace: true });
          },
          auto_select: !signedOut,
          use_fedcm_for_prompt: false,
        });
        gsi.renderButton(gsiRef.current, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          text: 'signin_with',
          shape: 'rectangular',
          width: 320,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, completeGoogleCredential, navigate, loading, user, signedOut]);

  if (loading) {
    return (
      <div className="loginShell">
        <div className="loginCard panel" style={{ textAlign: 'center' }}>
          <div className="muted">Checking your session…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="loginShell">
      <div className="loginCard panel">
        <div className="loginThemeRow">
          <ThemeToggle />
          <ColorModeToggle />
        </div>
        <div className="loginBrand">
          <img src="/leet.png" alt="" width={64} height={64} className="loginLogo" />
          <div>
            <div className="loginTitle">Leet Alert</div>
            <div className="muted loginSubtitle">Sign in to your operations workspace</div>
          </div>
        </div>

        {clientId ? (
          <div ref={gsiRef} className="loginGsiMount" />
        ) : (
          <button
            type="button"
            className="primary"
            onClick={async () => {
              const ok = await signIn();
              if (ok) navigate('/', { replace: true });
            }}
          >
            Sign in
          </button>
        )}
        {!clientId ? (
          <p className="muted" style={{ marginTop: 12, fontSize: 12, marginBottom: 0 }}>
            Set <code>GOOGLE_CLIENT_ID</code> (runtime <code>config.js</code> or Vite env) to enable Google sign-in.
          </p>
        ) : null}
      </div>
    </div>
  );
}
