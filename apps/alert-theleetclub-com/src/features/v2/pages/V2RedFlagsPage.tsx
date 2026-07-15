import { RedFlagsPage } from '@/features/redflags/RedFlagsPage';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus chrome + full Classic Red Flags board (all columns, presets, popups). */
export function V2RedFlagsPage() {
  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Priority queue"
        title="Red Flags"
        description="Full Classic exception board — every column, compare preset, and popup — inside Fleet Intelligence."
      />
      <div className="v2BoardHost">
        <RedFlagsPage embedded />
      </div>
    </div>
  );
}
