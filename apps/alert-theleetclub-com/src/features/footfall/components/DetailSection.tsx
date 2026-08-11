import type { ReactNode } from 'react';
import { NightChartContext } from '@/features/footfall/NightChartContext';

type Props = {
  id: string;
  focusMode: boolean;
  focusedSection: string | null;
  children: ReactNode;
  className?: string;
};

export function DetailSection({ id, focusMode, focusedSection, children, className }: Props) {
  const dimmed = Boolean(focusMode && focusedSection && focusedSection !== id);
  const active = Boolean(focusMode && focusedSection === id);
  const nightCharts = active && focusMode;

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
