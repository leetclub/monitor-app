import { PerformancePage } from '@/features/performance/PerformancePage';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus chrome + Classic Performance charts/filters. */
export function V2PerformancePage() {
  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Performance intelligence"
        title="Trajectory"
        description="Manus layout with Classic machine filter, presets, ranking, product cups, and trajectory charts."
      />
      <PerformancePage variant="manus" />
    </div>
  );
}
