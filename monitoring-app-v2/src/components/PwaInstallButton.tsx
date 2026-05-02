import { usePwaInstall } from '@/hooks/usePwaInstall';
import styles from './PwaInstallButton.module.css';

/**
 * Install affordances — hidden entirely once the PWA is installed (standalone or persisted flag).
 */
export function PwaInstallButton() {
  const {
    showChromeInstall,
    showIosInstallHelp,
    isChromeOnIos,
    showAndroidInstallHelp,
    hintOpen,
    setHintOpen,
    promptInstall,
    hideAllInstallUi,
  } = usePwaInstall();

  if (hideAllInstallUi) {
    return null;
  }

  if (showChromeInstall) {
    return (
      <button type="button" className={styles.installBtn} onClick={() => void promptInstall()}>
        Install app
      </button>
    );
  }

  if (showIosInstallHelp) {
    return (
      <div className={styles.hintWrap}>
        <button
          type="button"
          className={styles.installBtn}
          aria-expanded={hintOpen}
          onClick={() => setHintOpen((o) => !o)}
        >
          Add to Home Screen
        </button>
        {hintOpen ? (
          <p className={styles.hint} role="note">
            {isChromeOnIos() ? (
              <>
                On iPhone, <strong>install only works in Safari</strong>. Open this address in Safari, then
                tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.
              </>
            ) : (
              <>
                Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.
              </>
            )}
          </p>
        ) : null}
      </div>
    );
  }

  if (showAndroidInstallHelp) {
    return (
      <div className={styles.hintWrap}>
        <button
          type="button"
          className={styles.installBtn}
          aria-expanded={hintOpen}
          onClick={() => setHintOpen((o) => !o)}
        >
          Install app
        </button>
        {hintOpen ? (
          <p className={styles.hint} role="note">
            In Chrome: tap <strong>⋮</strong> (menu) → <strong>Install app</strong> or{' '}
            <strong>Add to Home screen</strong>. If you do not see it, reload once after signing in — the
            site must finish loading first.
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
