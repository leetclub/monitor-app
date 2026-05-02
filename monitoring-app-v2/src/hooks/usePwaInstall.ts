import { useCallback, useEffect, useState } from 'react';
import {
  isStandaloneDisplayMode,
  persistPwaInstalledToStorage,
  readPwaInstalledFromStorage,
} from '@/lib/pwaInstalled';

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return /Mac/i.test(ua) && 'ontouchend' in document;
}

function isChromeOnIos(): boolean {
  return typeof navigator !== 'undefined' && /CriOS/i.test(navigator.userAgent) && isIos();
}

function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

function hasInstalledOrStandalone(): boolean {
  return isStandaloneDisplayMode() || readPwaInstalledFromStorage();
}

export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  /** Bumps after `appinstalled` so we re-read localStorage. */
  const [, bump] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);

  const blockInstallUi = hasInstalledOrStandalone();

  useEffect(() => {
    if (isStandaloneDisplayMode()) {
      return;
    }

    const onBip = (e: Event) => {
      if (hasInstalledOrStandalone()) {
        return;
      }
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      persistPwaInstalledToStorage();
      setDeferred(null);
      bump((n) => n + 1);
    };

    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }, [deferred]);

  const showChromeInstall = Boolean(deferred) && !blockInstallUi;
  const showIosInstallHelp = isIos() && !blockInstallUi && !showChromeInstall;
  const showAndroidInstallHelp = isAndroid() && !blockInstallUi && !showChromeInstall;

  return {
    showChromeInstall,
    showIosInstallHelp,
    isChromeOnIos,
    showAndroidInstallHelp,
    hintOpen,
    setHintOpen,
    promptInstall,
    hideAllInstallUi: blockInstallUi,
  };
}
