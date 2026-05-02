import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { loadGsiScript } from '@/lib/gsi';

export function LoginPage() {
  const { signIn, completeGoogleCredential } = useAuth();
  const navigate = useNavigate();
  const gsiRef = useRef<HTMLDivElement>(null);

  const clientId = getAlertRuntimeEnv().GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    if (!clientId || !gsiRef.current) return;
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
          auto_select: false,
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
  }, [clientId, completeGoogleCredential, navigate]);

  return (
    <div className="loginShell">
      <div className="loginCard panel">
        <div className="loginBrand">
          <img src="/leet.png" alt="" width={72} height={72} className="loginLogo" />
          <div>
            <div className="loginTitle">Leet Alert</div>
            <div className="muted loginSubtitle">Operational alerts — sign in to continue</div>
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
