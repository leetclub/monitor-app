import { createContext, useContext, useSyncExternalStore } from 'react';
import { documentIsDarkMode, subscribeColorMode } from '@/lib/colorMode';

/** True when presenter night mode is on and this section is the focused panel. */
export const NightChartContext = createContext(false);

function useAlertDarkMode(): boolean {
  return useSyncExternalStore(subscribeColorMode, documentIsDarkMode, () => true);
}

/** Night chart palette when Alert is dark, or when night-focus highlights this section. */
export function useNightChart(): boolean {
  const focusNight = useContext(NightChartContext);
  const darkMode = useAlertDarkMode();
  return darkMode || focusNight;
}
