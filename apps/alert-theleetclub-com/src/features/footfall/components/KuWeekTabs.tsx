import { WINDOW_KU_JUL } from '@/features/footfall/lib/segments';

/** KU uses a single reference week (Jul 2025). Kept for layout compatibility. */
type Props = {
  value: string;
  onChange: (id: string) => void;
};

export function KuWeekTabs(_props: Props) {
  const w = WINDOW_KU_JUL;
  return (
    <div className="weekTabs" role="status" aria-label="KU reference week">
      <span className="weekTabsLabel">KU week</span>
      <span className="weekTab weekTabActive">{w.shortLabel}</span>
    </div>
  );
}
