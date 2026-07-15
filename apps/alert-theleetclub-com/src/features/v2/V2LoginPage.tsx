import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { loadGsiScript } from '@/lib/gsi';
import '@/features/v2/v2-theme.css';

const NEXT_KEY = 'alert_v2_next';

function gsiButtonWidth(el: HTMLElement | null): number {
  if (!el) return 280;
  const w = Math.floor(el.getBoundingClientRect().width);
  return Math.max(220, Math.min(360, w || 280));
}

export function V2LoginPage() {
  const { user, loading, signIn, completeGoogleCredential } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const gsiRef = useRef<HTMLDivElement>(null);
  const [gsiError, setGsiError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
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

  useLayoutEffect(() => {
    if (!clientId || !gsiRef.current || loading || user) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    const mountButton = async () => {
      try {
        await loadGsiScript();
        if (cancelled || !gsiRef.current || !(window as any).google?.accounts?.id) {
          if (!cancelled) setGsiError('Google Sign-In could not load. Use Continue securely.');
          return;
        }
        setGsiError(null);
        const gsi = (window as any).google.accounts.id;
        gsi.initialize({
          client_id: clientId,
          callback: async (resp: { credential?: string }) => {
            setSigningIn(true);
            try {
              const ok = await completeGoogleCredential(String(resp?.credential || ''));
              if (ok) navigate(nextPath, { replace: true });
              else setGsiError('Sign-in was rejected. Try again or contact an admin.');
            } finally {
              setSigningIn(false);
            }
          },
          auto_select: false,
          use_fedcm_for_prompt: false,
        });

        let lastW = 0;
        const paint = () => {
          const host = gsiRef.current;
          if (!host || cancelled) return;
          const w = gsiButtonWidth(host);
          if (Math.abs(w - lastW) < 8 && lastW > 0) return;
          lastW = w;
          host.innerHTML = '';
          gsi.renderButton(host, {
            theme: 'filled_black',
            size: 'large',
            type: 'standard',
            text: 'signin_with',
            shape: 'rectangular',
            width: w,
          });
        };

        paint();
        if (typeof ResizeObserver !== 'undefined' && gsiRef.current) {
          ro = new ResizeObserver(() => paint());
          ro.observe(gsiRef.current.parentElement || gsiRef.current);
        }
      } catch {
        if (!cancelled) setGsiError('Google Sign-In failed to start.');
      }
    };

    void mountButton();
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [clientId, completeGoogleCredential, navigate, loading, user, nextPath]);

  if (loading) {
    return (
      <div className="v2LoginShell v2LoginShellSolo">
        <div className="v2LoginCard v2LoginCardCenter">
          <p className="v2LoginMuted">Checking your session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="v2LoginShell">
      <section className="v2LoginHero" aria-label="Leet Alert v2">
        <div className="v2LoginBrand">
          <img src="/leet.png" alt="" width={48} height={48} className="v2LoginLogo" />
          <div>
            <p className="v2LoginBrandName">Leet Alert</p>
            <p className="v2LoginBrandSub">Fleet intelligence</p>
          </div>
        </div>
        <p className="v2LoginEyebrow">Operations command center</p>
        <h1>Every machine. Every signal. One decisive view.</h1>
        <p className="v2LoginLead">
          Sign in for live Red Flags, Overall, QA, Performance, and Admin — same data as Classic,
          Manus workspace chrome.
        </p>
        <div className="v2LoginFeatures">
          <div>
            <strong>01</strong>
            <span>Live exceptions</span>
          </div>
          <div>
            <strong>02</strong>
            <span>QA & performance</span>
          </div>
          <div>
            <strong>03</strong>
            <span>Role-scoped access</span>
          </div>
        </div>
      </section>

      <div className="v2LoginCard">
        <h2>Secure access</h2>
        <p className="v2LoginMuted">
          Continue with your Leet Google account. Your role decides which machines and controls you
          see.
        </p>

        {clientId ? (
          <div className="v2LoginGsiWrap">
            <div ref={gsiRef} className="v2LoginGsi" aria-busy={signingIn} />
            {signingIn ? <p className="v2LoginMuted v2LoginStatus">Signing you in…</p> : null}
            {gsiError ? <p className="v2LoginError">{gsiError}</p> : null}
          </div>
        ) : null}

        <button
          type="button"
          className="v2LoginPrimary"
          disabled={signingIn}
          onClick={async () => {
            setSigningIn(true);
            setGsiError(null);
            try {
              const ok = await signIn();
              if (ok) navigate(nextPath, { replace: true });
              else setGsiError('Sign-in did not complete. Try again.');
            } finally {
              setSigningIn(false);
            }
          }}
        >
          {signingIn ? 'Please wait…' : 'Continue securely'}
        </button>

        <p className="v2LoginFoot">
          Identity and access controls enabled
          <span aria-hidden> · </span>
          <Link to="/login" className="v2LoginClassicLink">
            Classic / Pro login
          </Link>
        </p>
      </div>
    </div>
  );
}
