import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { loadGsiScript } from '@/lib/gsi';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAlertUiTheme } from '@/lib/useAlertUiTheme';

export function LoginPage() {
  const { user, loading, signIn, completeGoogleCredential } = useAuth();
  const navigate = useNavigate();
  const gsiRef = useRef<HTMLDivElement>(null);
  const theme = useAlertUiTheme();
  const isPro = theme === 'pro';

  const clientId = getAlertRuntimeEnv().GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    if (!loading && user) {
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
            const ok = await completeGoogleCredential(String(resp?.credential || ''));
            if (ok) navigate('/', { replace: true });
          },
          auto_select: true,
          use_fedcm_for_prompt: false,
        });
        gsi.renderButton(gsiRef.current, {
          theme: isPro ? 'filled_black' : 'outline',
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
  }, [clientId, completeGoogleCredential, navigate, loading, user, isPro]);

  if (loading) {
    return (
      <div className="loginShell">
        <div className="loginCard panel" style={{ textAlign: 'center' }}>
          <div className="muted">Checking your session…</div>
        </div>
      </div>
    );
  }

  const signInBlock = (
    <>
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
          {isPro ? 'Continue securely' : 'Sign in'}
        </button>
      )}
      {!clientId ? (
        <p className="muted" style={{ marginTop: 12, fontSize: 12, marginBottom: 0 }}>
          Set <code>GOOGLE_CLIENT_ID</code> (runtime <code>config.js</code> or Vite env) to enable Google
          sign-in.
        </p>
      ) : null}
    </>
  );

  if (isPro) {
    return (
      <div className="loginShell">
        <section className="loginFleetHero" aria-label="Leet Alert">
          <p className="loginFleetEyebrow"># Operations command center</p>
          <h1>Every machine. Every signal. One decisive view.</h1>
          <p>
            Monitor fleet health, investigate exceptions, record quality visits, and keep performance
            aligned with target — same Alert data, fleet-intelligence chrome.
          </p>
          <div className="loginFleetFeatures">
            <div>
              <strong>01</strong>
              <span>Live exceptions</span>
            </div>
            <div>
              <strong>02</strong>
              <span>QA controls</span>
            </div>
            <div>
              <strong>03</strong>
              <span>Role-scoped data</span>
            </div>
          </div>
        </section>

        <div className="loginCard panel">
          <div className="loginThemeRow">
            <ThemeToggle />
          </div>
          <div className="loginBrand">
            <img src="/leet.png" alt="" width={56} height={56} className="loginLogo" />
            <div>
              <div className="loginTitle">Secure access</div>
              <div className="muted loginSubtitle">
                Enter the operations workspace. Your role determines which machines and controls you
                see.
              </div>
            </div>
          </div>
          {signInBlock}
          <p className="muted" style={{ marginTop: 14, fontSize: 12, marginBottom: 0 }}>
            Identity and access controls enabled
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="loginShell">
      <div className="loginCard panel">
        <div className="loginThemeRow">
          <ThemeToggle />
        </div>
        <div className="loginBrand">
          <img src="/leet.png" alt="" width={64} height={64} className="loginLogo" />
          <div>
            <div className="loginTitle">Leet Alert</div>
            <div className="muted loginSubtitle">Sign in to your operations workspace</div>
          </div>
        </div>
        {signInBlock}
      </div>
    </div>
  );
}
