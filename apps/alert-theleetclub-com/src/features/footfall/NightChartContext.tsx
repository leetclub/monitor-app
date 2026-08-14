import { createContext, useContext, useSyncExternalStore } from 'react';
import { subscribeColorMode } from '@/lib/colorMode';
import { footfallSurfaceIsDark } from '@/features/footfall/lib/footfallDarkSurface';

export { footfallSurfaceIsDark };

/** True when presenter night mode is on and this section is the focused panel. */
export const NightChartContext = createContext(false);

export function useFootfallDarkSurface(): boolean {
  return useSyncExternalStore(subscribeColorMode, footfallSurfaceIsDark, () => true);
}

/** Night chart palette when Footfall sits on a dark surface, or night-focus is on. */
export function useNightChart(): boolean {
  const focusNight = useContext(NightChartContext);
  const darkMode = useFootfallDarkSurface();
  return darkMode || focusNight;
}
