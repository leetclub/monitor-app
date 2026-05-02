import { useEffect, useState } from 'react';
import { isStandaloneDisplayMode, readPwaInstalledFromStorage } from '@/lib/pwaInstalled';
import styles from './OpenInstalledAppBanner.module.css';

const SESSION_DISMISS_KEY = 'leet-monitor:dismiss-open-in-app-banner';

/**
 * When the user already installed the PWA but opened the site in a normal browser tab,
 * show a slim banner: browsers do not allow JS to reliably jump into the standalone window.
 * Chrome may show “Open in app” in the omnibox; this nudges users who use the home-screen icon.
 */
type Props = {
  /** e.g. Login page width alignment */
  className?: string;
};

export function OpenInstalledAppBanner({ className }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandaloneDisplayMode()) return;
    if (!readPwaInstalledFromStorage()) return;
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') return;
    } catch {
      /* ignore */
    }
    setVisible(true);
  }, []);

  if (!visible) {
    return null;
  }

  const dismiss = () => {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div className={`${styles.banner} ${className ?? ''}`} role="region" aria-label="Installed app reminder">
      <p className={styles.text}>
        You have <strong>Leet Monitor</strong> installed. For the app window, open it from your{' '}
        <strong>home screen</strong> or app drawer — or use Chrome’s <strong>Open in app</strong> when it
        appears in the address bar.
      </p>
      <button type="button" className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
