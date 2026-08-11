import { useSyncExternalStore, type ReactNode } from 'react';
import { NightChartContext } from '@/features/footfall/NightChartContext';
import { documentIsDarkMode, subscribeColorMode } from '@/lib/colorMode';

type Props = {
  id: string;
  focusMode: boolean;
  focusedSection: string | null;
  children: ReactNode;
  className?: string;
};

function useAlertDarkMode(): boolean {
  return useSyncExternalStore(subscribeColorMode, documentIsDarkMode, () => true);
}

export function DetailSection({ id, focusMode, focusedSection, children, className }: Props) {
  const darkMode = useAlertDarkMode();
  const dimmed = Boolean(focusMode && focusedSection && focusedSection !== id);
  const active = Boolean(focusMode && focusedSection === id);
  /* Alert dark mode → night chart palette; night-focus mode still forces night on the active panel. */
  const nightCharts = darkMode || (active && focusMode);

  return (
    <NightChartContext.Provider value={nightCharts}>
      <div
        id={id}
        className={[
          'detailSection',
          className,
          focusMode ? 'detailSectionNight' : '',
          dimmed ? 'detailFocusDimmed' : '',
          active ? 'detailFocusActive' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
    </NightChartContext.Provider>
  );
}
