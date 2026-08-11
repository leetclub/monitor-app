import { createContext, useContext } from 'react';

/** True when presenter night mode is on and this section is the focused panel. */
export const NightChartContext = createContext(false);

export function useNightChart(): boolean {
  return useContext(NightChartContext);
}
