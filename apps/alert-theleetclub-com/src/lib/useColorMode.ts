import { useEffect, useState } from 'react';
import {
  resolveColorMode,
  subscribeColorMode,
  type AlertColorMode,
} from '@/lib/colorMode';
import { subscribeAlertUiTheme } from '@/lib/uiTheme';

/** Live light / dark mode (re-resolves when Classic/Pro shell changes if unset). */
export function useColorMode(): AlertColorMode {
  const [mode, setMode] = useState<AlertColorMode>(() => resolveColorMode());
  useEffect(() => {
    const sync = () => setMode(resolveColorMode());
    const unsubMode = subscribeColorMode(sync);
    const unsubTheme = subscribeAlertUiTheme(sync);
    return () => {
      unsubMode();
      unsubTheme();
    };
  }, []);
  return mode;
}
