import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { loadGsiScript } from '@/lib/gsi';
import '@/features/v2/v2-theme.css';

const NEXT_KEY = 'alert_v2_next';

export function V2LoginPage() {
  const { user, loading, signIn, completeGoogleCredential } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const gsiRef = useRef<HTMLDivElement>(null);
  const clientId = getAlertRuntimeEnv().GOOGLE_CLIENT_ID?.trim();

  const nextPath = (() => {
    const q = (params.get('next') || '').trim();
    if (q.startsWith('/v2')) return q;
    try {
      const stored = sessionStorage.getItem(NEXT_KEY) || '';
      if (stored.startsWith('/v2')) return stored;
    } catch {
      /* ignore */
    }
    return '/v2/red-flags';
  })();

  useEffect(() => {
    try {
      sessionStorage.setItem(NEXT_KEY, nextPath);
    } catch {
      /* ignore */
    }
  }, [nextPath]);

  useEffect(() => {
    if (!loading && user) {
      navigate(nextPath, { replace: true });
    }
  }, [loading, user, navigate, nextPath]);

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
            if (ok) navigate(nextPath, { replace: true });
          },
          auto_select: true,
          use_fedcm_for_prompt: false,
        });
        gsi.renderButton(gsiRef.current, {
          theme: 'filled_black',
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
  }, [clientId, completeGoogleCredential, navigate, loading, user, nextPath]);

  if (loading) {
    return (
      <div className="v2LoginShell" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="muted">Checking your session…</div>
      </div>
    );
  }

  return (
    <div className="v2LoginShell">
      <section className="v2LoginHero" aria-label="Leet Alert v2">
        <p className="v2LoginEyebrow"># Operations command center</p>
        <h1>Every machine. Every signal. One decisive view.</h1>
        <p>
          Alert v2 — fleet-intelligence chrome with the same live Red Flags, Overall, QA, Performance,
          and Admin data as production Alert.
        </p>
        <div className="v2LoginFeatures">
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

      <div className="v2LoginCard">
        <h2>Secure access</h2>
        <p className="muted">
          Enter the operations workspace. Your role determines which machines and controls you see.
        </p>
        {clientId ? (
          <div ref={gsiRef} />
        ) : (
          <button
            type="button"
            className="v2LoginPrimary"
            onClick={async () => {
              const ok = await signIn();
              if (ok) navigate(nextPath, { replace: true });
            }}
          >
            Continue securely
          </button>
        )}
        <p className="muted" style={{ marginTop: 14, fontSize: 12, marginBottom: 0 }}>
          Identity and access controls enabled ·{' '}
          <Link to="/login" style={{ color: '#5eead4' }}>
            Classic / Pro login
          </Link>
        </p>
      </div>
    </div>
  );
}
