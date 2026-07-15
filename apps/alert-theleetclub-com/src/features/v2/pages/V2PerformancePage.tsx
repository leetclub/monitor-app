import { PerformancePage } from '@/features/performance/PerformancePage';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus chrome + full Classic Performance charts and filters. */
export function V2PerformancePage() {
  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Performance intelligence"
        title="Trajectory"
        description="Full Classic Performance — machine filter, presets, ranking, product cups, and trajectory charts."
      />
      <div className="v2BoardHost">
        <PerformancePage embedded />
      </div>
    </div>
  );
}
