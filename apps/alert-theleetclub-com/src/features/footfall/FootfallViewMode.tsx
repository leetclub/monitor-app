import { createContext, useContext, type ReactNode } from 'react';

export type FootfallViewMode = 'adjusted' | 'raw';

const FootfallViewModeContext = createContext<FootfallViewMode>('raw');

export function FootfallViewModeProvider({
  mode,
  children,
}: {
  mode: FootfallViewMode;
  children: ReactNode;
}) {
  return <FootfallViewModeContext.Provider value={mode}>{children}</FootfallViewModeContext.Provider>;
}

export function useFootfallViewMode(): FootfallViewMode {
  return useContext(FootfallViewModeContext);
}
