import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';
import { OpenInstalledAppBanner } from '@/components/OpenInstalledAppBanner';
import { getMonitoringRuntimeEnv } from '@/config/runtimeEnv';
import { loadGsiScript } from '@/lib/gsi';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { signIn, completeGoogleCredential } = useAuth();
  const navigate = useNavigate();
  const gsiRef = useRef<HTMLDivElement>(null);

  const clientId = getMonitoringRuntimeEnv().GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    if (!clientId || !gsiRef.current) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await loadGsiScript();
        if (cancelled || !gsiRef.current || !window.google?.accounts?.id) {
          return;
        }
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp) => {
            const ok = await completeGoogleCredential(resp.credential);
            if (ok) {
              navigate('/', { replace: true });
            }
          },
        });
        window.google.accounts.id.renderButton(gsiRef.current, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          text: 'signin_with',
          shape: 'rectangular',
          width: 280,
        });
      } catch {
        /* GSI failed to load */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, completeGoogleCredential, navigate]);

  return (
    <div className={styles.wrap}>
      <OpenInstalledAppBanner className={styles.loginBanner} />
      <div className={styles.card}>
        <BrandLogo size={200} className={styles.hero} />
        <h1 className={styles.title}>Leet Monitor</h1>
        <p className={styles.sub}>Sign in to continue</p>
        {clientId ? (
          <div className={styles.gsiWrap} ref={gsiRef} />
        ) : (
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
        )}
      </div>
    </div>
  );
}
